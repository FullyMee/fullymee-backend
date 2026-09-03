const app = require('./app');
const http = require('http');
const { Server } = require('socket.io');
const { connectDB, mongoose } = require('./config/db');
const { validateJwtConfig, validateCookieConfig } = require('./utils/authToken');
const Conversation = require('./models/conversation.model');
const Message = require('./models/message.model');
const ConversationRead = require('./models/conversationRead.model');
const { getNextSequence } = require('./utils/sequence');
const { initializeBloomFilters, rememberClientMessageId } = require('./services/bloomFilter.service');
const messageService = require('./services/message.service');

const { socketMessageSchema, markReadSchema, typingSchema } = require('./validators/socket.validator');
const { verifySMTPConnection } = require('./utils/email.notification');
const { getSocketToken, verifyAuthToken } = require('./utils/authToken');
const { registerConfessionSocket } = require('./sockets/confession.socket');
const { initializeIdentityData } = require('./services/auth.service');

if (String(process.env.ENABLE_MESSAGE_CLEANUP_WORKER || '').toLowerCase() === 'true') {
    require('./workers/expiry.worker');
}

if (String(process.env.ENABLE_CONFESSION_ROOM_EXPIRY_WORKER || '').toLowerCase() === 'true') {
    require('./workers/confessionRoomExpiry.worker');
}

if (String(process.env.ENABLE_CONFESSION_SCHEDULER_WORKER || 'true').toLowerCase() !== 'false') {
    require('./workers/confessionScheduler.worker');
}

if (String(process.env.ENABLE_AUDIO_EXPIRY_WORKER || 'true').toLowerCase() !== 'false') {
    require('./workers/audioExpiry.worker');
}

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS || 10000);
let isShuttingDown = false;

function getRequiredEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`Missing required env: ${name}`);
    }
    return value;
}

function validateRuntimeConfig() {
    validateJwtConfig();
    validateCookieConfig();
}

async function ensurePermanentMessageStorage() {
    try {
        const indexes = await Message.collection.indexes();
        for (const idx of indexes) {
            const isTtl = idx.name === 'expiresAt_ttl' || (idx.key && idx.key.expiresAt === 1);
            const isOldCompound = idx.key && idx.key.conversationId === 1 && idx.key.expiresAt === 1;
            if (isTtl || isOldCompound) {
                try {
                    await Message.collection.dropIndex(idx.name);
                    console.log(`[PermanentStorage] Dropped legacy expiry index ${idx.name} from messages collection.`);
                } catch (e) {
                    console.warn(`[PermanentStorage] Notice dropping index ${idx.name}:`, e.message);
                }
            }
        }
        await Message.createIndexes();
    } catch (err) {
        console.warn('[PermanentStorage] Index check notice:', err.message);
    }
}

function getAllowedOrigins() {
    const raw = String(process.env.CORS_ORIGIN || '').trim();
    if (!raw) {
        return ['http://localhost:5173', 'http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const allowedOrigins = getAllowedOrigins();

const { setIO, getOnlineUsers } = require('./utils/socket');
const onlineUsers = getOnlineUsers();

const socketRateMap = new Map();

// Message batching config and buffer
const fs = require('fs');
const os = require('os');

// Metrics and batching
const METRICS_DIR = 'metrics';
try { fs.mkdirSync(METRICS_DIR, { recursive: true }); } catch (e) { }

const PERSIST_LATENCY_CSV = `${METRICS_DIR}/persist_latency.csv`;
const RESOURCE_LOG_CSV = `${METRICS_DIR}/resource_log.csv`;

if (!fs.existsSync(PERSIST_LATENCY_CSV)) {
    fs.writeFileSync(PERSIST_LATENCY_CSV, 'timestamp,messageId,latencyMs\n');
}
if (!fs.existsSync(RESOURCE_LOG_CSV)) {
    fs.writeFileSync(RESOURCE_LOG_CSV, 'timestamp,rss,heapUsed,heapTotal,external,cpuUser,cpuSystem,cpus\n');
}

const ENQUEUE_MAP = new Map();
const ENQUEUE_MAP_MAX_SIZE = 10000;
const ENQUEUE_MAP_TTL_MS = 5 * 60 * 1000;

const PERSIST_METRICS = [];
const PERSIST_METRICS_MAX_SIZE = 1000;

function pushPersistMetric(entry) {
    PERSIST_METRICS.push(entry);
    if (PERSIST_METRICS.length > PERSIST_METRICS_MAX_SIZE) {
        PERSIST_METRICS.splice(0, PERSIST_METRICS.length - PERSIST_METRICS_MAX_SIZE);
    }
}

function setEnqueueTimestamp(id, ts = Date.now()) {
    if (ENQUEUE_MAP.size >= ENQUEUE_MAP_MAX_SIZE) {
        const cutoff = Date.now() - ENQUEUE_MAP_TTL_MS;
        for (const [key, val] of ENQUEUE_MAP.entries()) {
            if (val < cutoff || ENQUEUE_MAP.size >= ENQUEUE_MAP_MAX_SIZE) {
                ENQUEUE_MAP.delete(key);
            }
        }
    }
    ENQUEUE_MAP.set(id, ts);
}

// Periodic memory eviction routine to eliminate in-memory collection leaks
setInterval(() => {
    try {
        const now = Date.now();
        const enqueueCutoff = now - ENQUEUE_MAP_TTL_MS;
        for (const [key, val] of ENQUEUE_MAP.entries()) {
            if (val < enqueueCutoff) {
                ENQUEUE_MAP.delete(key);
            }
        }

        const rateCutoff = now - 60000;
        for (const [userId, data] of socketRateMap.entries()) {
            if (!data || !data.start || data.start < rateCutoff) {
                socketRateMap.delete(userId);
            }
        }

        if (PERSIST_METRICS.length > PERSIST_METRICS_MAX_SIZE) {
            PERSIST_METRICS.splice(0, PERSIST_METRICS.length - PERSIST_METRICS_MAX_SIZE);
        }
    } catch (_) { }
}, 60000);

// Production-friendly batching defaults
const MESSAGE_BATCH = {
    buffer: [],
    batchSize: Number(process.env.MESSAGE_BATCH_SIZE || 250),
    flushIntervalMs: Number(process.env.MESSAGE_BATCH_FLUSH_MS || 150),
    maxBufferSize: Number(process.env.MESSAGE_BATCH_MAX_SIZE || 10000),
    flushing: false
};

// Reconciliation queue: when worker is disabled we keep reconcile logic here
const RECONCILE_MAP = new Map(); // clientMessageId -> doc
const RECONCILE_SET = new Set(); // clientMessageId
const RECONCILE_INTERVAL_MS = Number(process.env.RECONCILE_INTERVAL_MS || 500);

// Persistence worker process (optional) with heartbeat and auto-restart/backoff
const { fork } = require('child_process');
let persistWorker = null;
let persistWorkerAlive = false;
let lastPersistHeartbeat = 0;
const PERSIST_WORKER_ENABLED = String(process.env.PERSIST_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
const metrics = require('./metrics/prometheus');

async function startPersistWorker() {
    if (!PERSIST_WORKER_ENABLED) return;
    let backoff = 1000;
    const maxBackoff = 30000;

    const spawn = () => {
        try {
            persistWorker = fork(require('path').join(__dirname, 'workers', 'persist.worker.js'), { env: process.env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
            persistWorkerAlive = false;
            lastPersistHeartbeat = Date.now();

            persistWorker.on('error', (err) => console.error('persistWorker error:', err));

            persistWorker.on('exit', (code, sig) => {
                console.warn('persistWorker exited:', code, sig);
                persistWorkerAlive = false;
                metrics.setWorkerUp(0);
                // schedule restart with backoff
                setTimeout(() => {
                    backoff = Math.min(maxBackoff, backoff * 2);
                    spawn();
                }, backoff);
            });

            persistWorker.on('message', (msg) => {
                try {
                    if (!msg || !msg.type) return;
                    if (msg.type === 'heartbeat') {
                        lastPersistHeartbeat = msg.ts || Date.now();
                        if (!persistWorkerAlive) {
                            persistWorkerAlive = true;
                            metrics.setWorkerUp(1);
                        }
                        return;
                    }
                    if (msg.type === 'persisted') {
                        const now = msg.now || Date.now();
                        const ids = Array.isArray(msg.ids) ? msg.ids : [];
                        for (const id of ids) {
                            try {
                                const enqueued = ENQUEUE_MAP.get(id);
                                if (enqueued) {
                                    const latency = now - enqueued;
                                    pushPersistMetric({ timestamp: now, messageId: id, latency });
                                    try { fs.appendFile(PERSIST_LATENCY_CSV, `${now},${id},${latency}\n`, () => { }); } catch (e) { }
                                    ENQUEUE_MAP.delete(id);
                                    try { metrics.recordPersist(latency); } catch (e) { }
                                }
                            } catch (e) { }
                        }
                    }
                } catch (e) {
                    console.error('Error handling persistWorker message:', e && e.message ? e.message : e);
                }
            });
        } catch (e) {
            console.error('Failed to start persist worker:', e && e.message ? e.message : e);
            persistWorker = null;
            persistWorkerAlive = false;
            metrics.setWorkerUp(0);
            setTimeout(spawn, backoff);
            backoff = Math.min(maxBackoff, backoff * 2);
        }
    };

    spawn();
    // monitor heartbeats
    setInterval(() => {
        const now = Date.now();
        if (!persistWorker) return;
        const delta = now - (lastPersistHeartbeat || 0);
        if (delta > 6000) {
            // consider worker dead
            try {
                persistWorkerAlive = false;
                metrics.setWorkerUp(0);
                try { persistWorker.kill('SIGTERM'); } catch (e) { }
            } catch (e) { }
        }
    }, 3000);
}

startPersistWorker();

function enqueuePersistMessage(msg) {
    if (MESSAGE_BATCH.buffer.length >= MESSAGE_BATCH.maxBufferSize) {
        return false;
    }
    // If persist worker is enabled but not alive, apply conservative backpressure
    if (PERSIST_WORKER_ENABLED && !persistWorkerAlive && MESSAGE_BATCH.buffer.length >= Math.max(100, MESSAGE_BATCH.batchSize * 4)) {
        return false;
    }
    MESSAGE_BATCH.buffer.push(msg);
    try { metrics.recordEnqueue(); } catch (e) { }
    try { setEnqueueTimestamp(msg.id); } catch (e) { }
    try { metrics.setQueueLength(MESSAGE_BATCH.buffer.length); } catch (e) { }
    if (MESSAGE_BATCH.buffer.length >= MESSAGE_BATCH.batchSize) {
        flushPersistBatch().catch((err) => console.error('Batch flush error:', err));
    }
    return true;
}

async function flushPersistBatch() {
    if (MESSAGE_BATCH.flushing) return;
    if (!MESSAGE_BATCH.buffer.length) return;
    MESSAGE_BATCH.flushing = true;
    const batch = MESSAGE_BATCH.buffer.splice(0, MESSAGE_BATCH.batchSize);
    try {
        if (persistWorker) {
            // Send batch and enqueue timestamps to worker and let it handle DB writes
            const ids = batch.map((b) => b && b.id).filter(Boolean);
            const enqueueTimes = {};
            for (const id of ids) {
                try { enqueueTimes[id] = ENQUEUE_MAP.get(id) || Date.now(); } catch (e) { }
            }
            try {
                persistWorker.send({ type: 'batch', batch, enqueueTimes });
            } catch (e) {
                console.error('Error sending batch to persistWorker:', e && e.message ? e.message : e);
                // fallback to direct insert
                await Message.insertMany(batch, { ordered: false });
                // compute latencies locally if fallback
                const found = await Message.find({ id: { $in: ids } }).select({ id: 1 }).lean();
                const foundIds = new Set(found.map((r) => r.id));
                const now = Date.now();
                for (const id of ids) {
                    const enqueued = ENQUEUE_MAP.get(id);
                    if (enqueued) {
                        const latency = foundIds.has(id) ? now - enqueued : -1;
                        pushPersistMetric({ timestamp: now, messageId: id, latency });
                        try { fs.appendFile(PERSIST_LATENCY_CSV, `${now},${id},${latency}\n`, () => { }); } catch (e) { }
                        ENQUEUE_MAP.delete(id);
                        try { metrics.recordPersist(latency); } catch (e) { }
                    }
                }
            }
        } else {
            // no worker: write directly
            try {
                await Message.insertMany(batch, { ordered: false });
            } catch (err) {
                console.error('Batch insertMany error:', err && err.message ? err.message : err);
            }

            // For any doc with clientMessageId, register in RECONCILE_MAP for async reconciliation
            const withClientIds = batch.filter((m) => m && m.clientMessageId);
            for (const doc of withClientIds) {
                try {
                    RECONCILE_MAP.set(doc.clientMessageId, doc);
                    RECONCILE_SET.add(doc.clientMessageId);
                } catch (e) { }
            }

            // compute persist latencies for items inserted
            try {
                const ids = batch.map((b) => b && b.id).filter(Boolean);
                if (ids.length) {
                    const found = await Message.find({ id: { $in: ids } }).select({ id: 1 }).lean();
                    const foundIds = new Set(found.map((r) => r.id));
                    const now = Date.now();
                    for (const id of ids) {
                        const enqueued = ENQUEUE_MAP.get(id);
                        if (enqueued) {
                            const latency = foundIds.has(id) ? now - enqueued : -1;
                            pushPersistMetric({ timestamp: now, messageId: id, latency });
                            try { fs.appendFile(PERSIST_LATENCY_CSV, `${now},${id},${latency}\n`, () => { }); } catch (e) { }
                            ENQUEUE_MAP.delete(id);
                            try { metrics.recordPersist(latency); } catch (e) { }
                        }
                    }
                }
            } catch (e) {
                console.error('Error computing persist latencies:', e && e.message ? e.message : e);
            }
        }
    } finally {
        MESSAGE_BATCH.flushing = false;
    }
}

setInterval(() => {
    flushPersistBatch().catch((err) => console.error('Periodic batch flush error:', err));
}, MESSAGE_BATCH.flushIntervalMs);

// Background reconciliation worker: coalesces missing clientMessageId upserts
setInterval(async () => {
    // If a persist worker is active it already performs reconciliation
    if (persistWorker) return;
    if (!RECONCILE_SET.size) return;
    const clientIds = Array.from(RECONCILE_SET).splice(0, 1000);
    const docs = clientIds.map((id) => RECONCILE_MAP.get(id)).filter(Boolean);
    try {
        const existing = await Message.find({ clientMessageId: { $in: clientIds } }).select({ clientMessageId: 1 }).lean();
        const existingSet = new Set(existing.map((r) => r.clientMessageId));
        const missing = docs.filter((d) => !existingSet.has(d.clientMessageId));
        if (missing.length) {
            const bulkOps = missing.map((doc) => ({
                updateOne: {
                    filter: { clientMessageId: doc.clientMessageId },
                    update: { $setOnInsert: doc },
                    upsert: true
                }
            }));
            if (bulkOps.length) {
                try {
                    await Message.bulkWrite(bulkOps, { ordered: false });
                } catch (e) {
                    console.error('Background reconcile bulkWrite error:', e && e.message ? e.message : e);
                    try { metrics.recordReconcileFailure(); } catch (e2) { }
                }
            }
        }
    } catch (err) {
        console.error('Background reconcile error:', err && err.message ? err.message : err);
    } finally {
        for (const id of clientIds) {
            RECONCILE_SET.delete(id);
            RECONCILE_MAP.delete(id);
        }
    }
}, RECONCILE_INTERVAL_MS);

// Resource sampling for diagnosis
let lastCpu = process.cpuUsage();
let lastTime = Date.now();
setInterval(() => {
    try {
        const mu = process.memoryUsage();
        const cpu = process.cpuUsage();
        const now = Date.now();
        const dt = Math.max(1, now - lastTime);
        const userDiff = cpu.user - lastCpu.user;
        const systemDiff = cpu.system - lastCpu.system;
        const cpuUser = Math.round((userDiff / 1000) / dt); // ms per ms -> approx %
        const cpuSystem = Math.round((systemDiff / 1000) / dt);
        const cpus = os.cpus().length;
        fs.appendFile(RESOURCE_LOG_CSV, `${now},${mu.rss},${mu.heapUsed},${mu.heapTotal},${mu.external},${cpuUser},${cpuSystem},${cpus}\n`, () => { });
        lastCpu = cpu;
        lastTime = now;
    } catch (e) { }
}, 1000);

function getOnlineUserIdsExcept(userId) {
    const currentUserId = Number(userId);
    return Array.from(onlineUsers.keys())
        .map((value) => Number(value))
        .filter((value) => value && value !== currentUserId);
}

function isRateLimited(userId, limit = 20, windowMs = 1000) {
    const now = Date.now();

    if (!socketRateMap.has(userId)) {
        socketRateMap.set(userId, { count: 1, start: now });
        return false;
    }

    const data = socketRateMap.get(userId);
    if (now - data.start > windowMs) {
        socketRateMap.set(userId, { count: 1, start: now });
        return false;
    }

    data.count++;
    return data.count > limit;
}

async function getAccessibleConversation(conversationId, userId) {
    const parsedConversationId = Number(conversationId);
    const parsedUserId = Number(userId);
    if (!parsedConversationId || Number.isNaN(parsedConversationId)) return null;
    if (!parsedUserId || Number.isNaN(parsedUserId)) return null;

    const conversation = await Conversation.findOne({
        id: parsedConversationId,
        participants: parsedUserId,
        deletedAt: null
    })
        .select({
            _id: 0,
            id: 1,
            participants: 1,
            status: 1,
            isArchived: 1,
            deletedAt: 1,
            participantMeta: 1,
            closingNoteText: 1,
            endedAt: 1
        })
        .lean();

    if (!conversation) return null;

    const meta = Array.isArray(conversation.participantMeta)
        ? conversation.participantMeta.find((row) => Number(row.userId) === parsedUserId)
        : null;
    if (meta && meta.isDeleted) return null;

    return conversation;
}

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Expose Prometheus metrics endpoint
try {
    const expressApp = app; // reuse existing express app
    expressApp.get('/-/metrics', metrics.metricsEndpoint);
    // Health and readiness probes
    const READINESS_MAX_QUEUE = Number(process.env.READINESS_MAX_QUEUE || 5000);

    expressApp.get(['/health', '/api/health'], (req, res) => {
        return res.status(200).json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    expressApp.get('/ready', (req, res) => {
        const dbReady = mongoose && mongoose.connection && mongoose.connection.readyState === 1;
        const queueLength = Array.isArray(MESSAGE_BATCH.buffer) ? MESSAGE_BATCH.buffer.length : 0;
        const workerAlive = Boolean(persistWorker && !persistWorker.killed);

        const ok = dbReady && queueLength <= READINESS_MAX_QUEUE && (persistWorker ? workerAlive : true);

        const body = {
            dbReady,
            queueLength,
            maxQueue: READINESS_MAX_QUEUE,
            persistWorker: Boolean(persistWorker),
            workerAlive
        };

        if (ok) return res.status(200).json(body);
        return res.status(503).json(body);
    });

    // Worker liveness probe (simple)
    expressApp.get('/health/worker', (req, res) => {
        const alive = Boolean(persistWorker && !persistWorker.killed);
        return res.status(alive ? 200 : 503).json({ worker: alive });
    });
} catch (e) {
    console.error('Failed to mount metrics endpoint:', e && e.message ? e.message : e);
}

setIO(io);
registerConfessionSocket(io);

try {
    const convService = require('./services/conversation.service');
    const socketUtils = require('./utils/socket');
    const ioInst = io;
    const onlineUsersMap = socketUtils.getOnlineUsers();

    convService.emitter.on('dm_created', ({ conversationId, participants }) => {
        try {
            for (const participantId of participants) {
                const sockets = onlineUsersMap.get(participantId);
                if (!sockets) continue;

                for (const sid of sockets) {
                    try {
                        ioInst.to(sid).emit('dm_created', {
                            conversationId,
                            otherUserId: participants.find((p) => p !== participantId)
                        });
                    } catch (emitErr) {
                        console.error('dm_created emit error:', emitErr);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling dm_created emitter:', err);
        }
    });

    convService.emitter.on('chat_request_created', ({ requestId, requesterUserId, targetUserId }) => {
        try {
            for (const participantId of [requesterUserId, targetUserId]) {
                const sockets = onlineUsersMap.get(participantId);
                if (!sockets) continue;

                for (const sid of sockets) {
                    try {
                        ioInst.to(sid).emit('chat_request_created', { requestId });
                    } catch (emitErr) {
                        console.error('chat_request_created emit error:', emitErr);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling chat_request_created emitter:', err);
        }
    });

    convService.emitter.on('chat_request_updated', ({ requestId, requesterUserId, targetUserId, status, conversationId }) => {
        try {
            for (const participantId of [requesterUserId, targetUserId]) {
                const sockets = onlineUsersMap.get(participantId);
                if (!sockets) continue;

                for (const sid of sockets) {
                    try {
                        ioInst.to(sid).emit('chat_request_updated', { requestId, status, conversationId });
                    } catch (emitErr) {
                        console.error('chat_request_updated emit error:', emitErr);
                    }
                }
            }
        } catch (err) {
            console.error('Error handling chat_request_updated emitter:', err);
        }
    });

    const emitToParticipants = (participantIds, eventName, payload) => {
        for (const participantId of participantIds || []) {
            const sockets = onlineUsersMap.get(Number(participantId));
            if (!sockets) continue;
            for (const sid of sockets) {
                try {
                    ioInst.to(sid).emit(eventName, payload);
                } catch (emitErr) {
                    console.error(`${eventName} emit error:`, emitErr);
                }
            }
        }
    };

    convService.emitter.on('conversation_ended', (payload) => {
        try {
            const publicPayload = {
                conversationId: payload.conversationId,
                status: payload.status,
                endedAt: payload.endedAt,
                endReason: payload.endReason,
                closingNoteId: payload.closingNoteId,
                closingNoteText: payload.closingNoteText
            };
            emitToParticipants(payload.participants, 'conversation_ended', publicPayload);
            ioInst.to(`conversation_${payload.conversationId}`).emit('conversation_ended', publicPayload);
        } catch (err) {
            console.error('Error handling conversation_ended emitter:', err);
        }
    });

    convService.emitter.on('conversation_paused', (payload) => {
        try {
            const data = {
                conversationId: payload.conversationId,
                status: payload.status,
                pausedBy: payload.pausedBy
            };
            emitToParticipants(payload.participants, 'conversation_paused', data);
            ioInst.to(`conversation_${payload.conversationId}`).emit('conversation_paused', data);
        } catch (err) {
            console.error('Error handling conversation_paused emitter:', err);
        }
    });

    convService.emitter.on('conversation_resumed', (payload) => {
        try {
            const data = {
                conversationId: payload.conversationId,
                status: payload.status
            };
            emitToParticipants(payload.participants, 'conversation_resumed', data);
            ioInst.to(`conversation_${payload.conversationId}`).emit('conversation_resumed', data);
        } catch (err) {
            console.error('Error handling conversation_resumed emitter:', err);
        }
    });
} catch (err) {
    console.error('Failed to wire conversation service emitter:', err);
}

io.use((socket, next) => {
    try {
        const token = getSocketToken(socket);
        if (!token) return next(new Error('Unauthorized'));
        const verifyOpts = {};
        const aud = String(process.env.JWT_AUD || '').trim();
        const iss = String(process.env.JWT_ISS || '').trim();
        const algs = String(process.env.JWT_ALG || 'HS256').split(',').map((s) => s.trim()).filter(Boolean);
        if (aud) verifyOpts.audience = aud;
        if (iss) verifyOpts.issuer = iss;
        if (algs.length) verifyOpts.algorithms = algs;

        const decoded = verifyAuthToken(token);

        // tokenVersion check (async)
        (async () => {
            try {
                const User = require('./models/user.model');
                const user = await User.findOne({ id: Number(decoded.userId) }).select({ tokenVersion: 1, id: 1 }).lean();
                if (!user || Number(user.tokenVersion || 0) !== Number(decoded.tokenVersion || 0)) {
                    return next(new Error('Unauthorized'));
                }
                socket.user = decoded;
                return next();
            } catch (e) {
                return next(new Error('Unauthorized'));
            }
        })();
    } catch (err) {
        next(new Error('Unauthorized'));
    }
});

function handleFatalError(label, err) {
    console.error(`${label}:`, err);
    gracefulShutdown(label).catch((shutdownErr) => {
        console.error('Fatal shutdown failed:', shutdownErr);
        process.exit(1);
    });
}

process.on('uncaughtException', (err) => {
    handleFatalError('Uncaught Exception', err);
});

process.on('unhandledRejection', (reason) => {
    handleFatalError('Unhandled Rejection', reason);
});

io.on('connection', (socket) => {
    const userId = socket.user.userId;
    console.log(`User ${userId} connected -> Socket ${socket.id}`);

    socket.join(`user_${userId}`);

    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    socket.emit('presence_snapshot', {
        userIds: getOnlineUserIdsExcept(userId)
    });

    if (onlineUsers.get(userId).size === 1) {
        socket.broadcast.emit('presence_update', { userId, status: 'online' });
    }

    socket.on('join_conversation', async (conversationId) => {
        const parsedConversationId = Number(conversationId);
        if (!parsedConversationId || Number.isNaN(parsedConversationId)) return;

        try {
            const conversation = await getAccessibleConversation(parsedConversationId, userId);
            if (!conversation) return;
            socket.join(`conversation_${parsedConversationId}`);
        } catch (err) {
            console.error('Join conversation validation error:', err);
        }
    });

    socket.on('sync_messages', async ({ conversationId, after }) => {
        try {
            const parsedConversationId = Number(conversationId);
            if (!parsedConversationId || Number.isNaN(parsedConversationId)) return;

            const lastMessageId = Number(after || 0);
            if (Number.isNaN(lastMessageId)) return;

            const conversation = await getAccessibleConversation(parsedConversationId, userId);
            if (!conversation) return;

            const rows = await messageService.fetchMessagesAfter(parsedConversationId, userId, lastMessageId);

            // Mark any missed incoming messages as delivered
            if (rows && rows.length > 0) {
                const incomingIds = rows.filter(r => Number(r.senderId) !== Number(userId)).map(r => r.id);
                if (incomingIds.length > 0) {
                    messageService.markMessagesDelivered(parsedConversationId, userId, incomingIds)
                        .then((delivered) => {
                            for (const item of delivered) {
                                io.to(`user_${item.senderId}`).emit('message_status_update', {
                                    conversationId: parsedConversationId,
                                    messageId: item.messageId,
                                    status: 'delivered',
                                    deliveredAt: item.deliveredAt
                                });
                            }
                        })
                        .catch((e) => console.error('Sync delivery mark error:', e));
                }
            }

            socket.emit('sync_result', {
                conversationId: parsedConversationId,
                messages: rows
            });
        } catch (err) {
            console.error('Sync error:', err);
        }
    });

    socket.on('send_message', async (data, callback) => {
        const safeCallback = typeof callback === 'function' ? callback : () => { };

        try {
            if (isRateLimited(userId)) {
                return safeCallback({ status: 'rate_limited' });
            }

            const parsed = socketMessageSchema.safeParse(data);
            if (!parsed.success) return safeCallback({ status: 'error' });

            const { clientMessageId, conversationId, content } = parsed.data;
            const senderId = socket.user.userId;

            // Direct durable persistence in MongoDB first (guaranteed zero message loss)
            let savedMessage;
            try {
                savedMessage = await messageService.createMessage(
                    conversationId,
                    senderId,
                    content,
                    clientMessageId || null
                );
            } catch (createErr) {
                if (createErr && createErr.code === 'CONVERSATION_CLOSED') {
                    return safeCallback({
                        status: 'conversation_closed',
                        code: 'CONVERSATION_CLOSED',
                        message: 'This conversation has come to an end.'
                    });
                }
                if (createErr && createErr.code === 'CONVERSATION_PAUSED') {
                    return safeCallback({
                        status: 'conversation_paused',
                        code: 'CONVERSATION_PAUSED',
                        message: 'This conversation is paused.'
                    });
                }
                if (createErr && Number.isFinite(createErr.status)) {
                    return safeCallback({ status: 'error', message: createErr.message });
                }
                throw createErr;
            }

            const conversation = await Conversation.findOne({ id: conversationId })
                .select({ _id: 0, participants: 1 })
                .lean();

            const participants = (conversation && conversation.participants) || [];

            // Check if any recipient is actively connected in their user room
            let recipientConnected = false;
            for (const participantId of new Set(participants)) {
                if (Number(participantId) !== Number(senderId)) {
                    const room = io.sockets.adapter.rooms.get(`user_${participantId}`);
                    if (room && room.size > 0) {
                        recipientConnected = true;
                    }
                }
            }

            // If recipient is connected, update message to delivered immediately
            let currentStatus = savedMessage.status || 'sent';
            let deliveredAt = savedMessage.deliveredAt || null;
            if (recipientConnected && currentStatus === 'sent') {
                const deliveredList = await messageService.markMessagesDelivered(conversationId, senderId, [savedMessage.id]);
                if (deliveredList && deliveredList.length > 0) {
                    currentStatus = 'delivered';
                    deliveredAt = deliveredList[0].deliveredAt;
                }
            }

            const payload = {
                id: savedMessage.id,
                seq: savedMessage.seq,
                clientMessageId: savedMessage.clientMessageId,
                conversationId: savedMessage.conversationId,
                senderId: savedMessage.senderId,
                content: savedMessage.content,
                status: currentStatus,
                createdAt: savedMessage.createdAt,
                deliveredAt,
                readAt: savedMessage.readAt || null
            };

            for (const participantId of new Set(participants)) {
                io.to(`user_${participantId}`).emit('receive_message', payload);

                if (Number(participantId) !== Number(senderId)) {
                    io.to(`user_${participantId}`).emit('unread_update', { conversationId });
                }
            }

            // Acknowledge back to sender with durable message data
            return safeCallback({
                status: currentStatus,
                messageId: savedMessage.id,
                seq: savedMessage.seq,
                clientMessageId: savedMessage.clientMessageId,
                message: payload
            });
        } catch (err) {
            console.error('Message send error:', err);
            return safeCallback({ status: 'failed' });
        }
    });

    socket.on('message_delivered', async (data) => {
        try {
            if (!data) return;
            const conversationId = Number(data.conversationId);
            const messageId = Number(data.messageId);
            const messageIds = Array.isArray(data.messageIds) ? data.messageIds : (messageId ? [messageId] : null);
            if (!conversationId) return;

            const delivered = await messageService.markMessagesDelivered(conversationId, userId, messageIds);
            for (const item of delivered) {
                io.to(`user_${item.senderId}`).emit('message_status_update', {
                    conversationId,
                    messageId: item.messageId,
                    status: 'delivered',
                    deliveredAt: item.deliveredAt
                });
            }
        } catch (err) {
            console.error('message_delivered error:', err);
        }
    });

    socket.on('mark_read', async (data) => {
        try {
            if (isRateLimited(userId, 5)) return;

            const parsed = markReadSchema.safeParse(data);
            if (!parsed.success) return;

            const { conversationId, messageId } = parsed.data;
            const conversation = await getAccessibleConversation(conversationId, userId);
            if (!conversation || conversation.status === 'ENDED' || conversation.status === 'PAUSED') return;

            await ConversationRead.findOneAndUpdate(
                { conversationId, userId },
                {
                    conversationId,
                    userId,
                    lastReadMessageId: messageId,
                    updatedAt: new Date()
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            const readItems = await messageService.markMessagesRead(conversationId, userId, messageId);

            socket.to(`conversation_${conversationId}`).emit('read_update', { userId, messageId });
            io.to(`conversation_${conversationId}`).emit('unread_reset', { conversationId, userId });
            io.to(`user_${userId}`).emit('unread_reset', { conversationId, userId });

            // Notify senders that their messages are now READ
            const sendersNotified = new Set();
            for (const item of readItems) {
                if (!sendersNotified.has(item.senderId)) {
                    sendersNotified.add(item.senderId);
                    io.to(`user_${item.senderId}`).emit('message_status_update', {
                        conversationId,
                        upToMessageId: messageId,
                        status: 'read',
                        readAt: item.readAt
                    });
                }
            }
        } catch (err) {
            console.error('Read update error:', err);
        }
    });

    socket.on('typing_start', (data) => {
        if (isRateLimited(userId, 10)) return;

        const parsed = typingSchema.safeParse(data);
        if (!parsed.success) return;

        const { conversationId } = parsed.data;
        getAccessibleConversation(conversationId, userId)
            .then((conversation) => {
                if (!conversation || conversation.status === 'ENDED' || conversation.status === 'PAUSED') return;
                socket.to(`conversation_${conversationId}`).emit('user_typing', { userId });
            })
            .catch((err) => {
                console.error('Typing start validation error:', err);
            });
    });

    socket.on('typing_stop', (data) => {
        if (isRateLimited(userId, 10)) return;

        const parsed = typingSchema.safeParse(data);
        if (!parsed.success) return;

        const { conversationId } = parsed.data;
        getAccessibleConversation(conversationId, userId)
            .then((conversation) => {
                if (!conversation || conversation.status === 'ENDED' || conversation.status === 'PAUSED') return;
                socket.to(`conversation_${conversationId}`).emit('user_stop_typing', { userId });
            })
            .catch((err) => {
                console.error('Typing stop validation error:', err);
            });
    });

    socket.on('disconnect', () => {
        if (!onlineUsers.has(userId)) return;

        const userSockets = onlineUsers.get(userId);
        userSockets.delete(socket.id);

        if (userSockets.size === 0) {
            onlineUsers.delete(userId);
            socketRateMap.delete(userId);
            socket.broadcast.emit('presence_update', { userId, status: 'offline' });
            console.log(`User ${userId} fully offline`);
        }
    });
});

async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`Received ${signal}. Starting graceful shutdown...`);

    const forceExitTimer = setTimeout(() => {
        console.error('Graceful shutdown timed out. Forcing exit.');
        process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
        io.close();
        // Stop accepting new connections and flush pending batches and reconciliation
        await new Promise((resolve, reject) => {
            if (!server.listening) return resolve();
            return server.close((err) => (err ? reject(err) : resolve()));
        });

        // Flush remaining batches
        await flushPersistBatch();

        // Run one final reconciliation pass
        try {
            const clientIds = Array.from(RECONCILE_SET);
            if (clientIds.length) {
                const docs = clientIds.map((id) => RECONCILE_MAP.get(id)).filter(Boolean);
                const existing = await Message.find({ clientMessageId: { $in: clientIds } }).select({ clientMessageId: 1 }).lean();
                const existingSet = new Set(existing.map((r) => r.clientMessageId));
                const missing = docs.filter((d) => !existingSet.has(d.clientMessageId));
                if (missing.length) {
                    const bulkOps = missing.map((doc) => ({
                        updateOne: { filter: { clientMessageId: doc.clientMessageId }, update: { $setOnInsert: doc }, upsert: true }
                    }));
                    if (bulkOps.length) await Message.bulkWrite(bulkOps, { ordered: false });
                }
            }
        } catch (e) {
            console.error('Shutdown reconciliation error:', e && e.message ? e.message : e);
        }
        if (mongoose.connection.readyState !== 0) {
            await mongoose.connection.close(false);
        }
        clearTimeout(forceExitTimer);
        console.log('Graceful shutdown completed.');
        process.exit(0);
    } catch (err) {
        clearTimeout(forceExitTimer);
        console.error('Graceful shutdown failed:', err && err.message ? err.message : err);
        process.exit(1);
    }
}

async function verifyEmailProviderOnStartup() {
    try {
        const hasResendKey = Boolean(String(process.env.RESEND_API_KEY || '').trim());
        const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

        // ── Resend API (Primary) ──
        if (hasResendKey) {
            console.log('[Email] ✓ Resend API key configured (primary provider).');
            console.log(`[Email]   Sender: ${process.env.EMAIL_FROM || process.env.RESEND_FROM || 'default'}`);
        } else {
            console.warn('[Email] ✗ RESEND_API_KEY not set. Resend API is disabled.');
        }

        // ── SMTP (Fallback) ──
        if (hasSmtp) {
            const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
            const port = process.env.SMTP_PORT || '465';
            const label = hasResendKey ? 'fallback' : 'primary';
            console.log(`[Email] ✓ SMTP configured as ${label} (host=${process.env.SMTP_HOST}, port=${port}, secure=${secure}).`);
            try {
                await verifySMTPConnection();
                console.log('[Email]   SMTP connection verified successfully.');
            } catch (err) {
                console.error('[Email]   SMTP verification failed. Check credentials and provider settings.');
                console.error('[Email]   SMTP error:', err && err.message ? err.message : err);
            }
        } else {
            console.warn('[Email] ✗ SMTP not fully configured (SMTP_HOST, SMTP_USER, SMTP_PASS required for fallback).');
        }

        // ── No provider at all ──
        if (!hasResendKey && !hasSmtp) {
            const level = process.env.NODE_ENV === 'production' ? 'error' : 'warn';
            console[level]('[Email] ⚠ No email provider configured. OTP delivery will fail in production.');
        }
    } catch (err) {
        console.error('[Email] Provider startup verification failed:', err && err.message ? err.message : err);
    }
}

async function startServer() {
    validateRuntimeConfig();

    try {
        await connectDB();
        await initializeIdentityData();
        await ensurePermanentMessageStorage();
        console.log('MongoDB connection verified successfully.');
    } catch (err) {
        console.error('MongoDB connection failed. Check MONGODB_URI and network access.');
        console.error('MongoDB error:', err && err.message ? err.message : err);
        process.exit(1);
    }

    try {
        await initializeBloomFilters();
        console.log('[Bloom] Warmed in-memory filters successfully.');
    } catch (err) {
        console.warn('[Bloom] Warmup failed, continuing without a preloaded bloom cache.');
        console.warn('[Bloom] Error:', err && err.message ? err.message : err);
    }

    const BLOOM_REFRESH_INTERVAL_MS = Number(process.env.BLOOM_REFRESH_INTERVAL_MS || 6 * 60 * 60 * 1000);
    setInterval(async () => {
        try {
            await initializeBloomFilters();
            console.log('[Bloom] Filters refreshed successfully.');
        } catch (err) {
            console.error('[Bloom] Periodic refresh failed:', err && err.message ? err.message : err);
        }
    }, BLOOM_REFRESH_INTERVAL_MS).unref();

    await verifyEmailProviderOnStartup();

    await new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('listening', onListening);
            reject(err);
        };
        const onListening = () => {
            server.off('error', onError);
            resolve();
        };

        server.once('error', onError);
        server.once('listening', onListening);
        // In cluster worker mode we will receive connections from master process.
        if (process.env.CLUSTER_WORKER === 'true') {
            // Do not call listen in worker; master will distribute sockets.
            resolve();
        } else {
            server.listen(PORT);
        }
    });

    console.log(`Server is running on port ${PORT}`);
}

startServer().catch((err) => {
    if (err && err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please use a different port.`);
    } else {
        console.error('Server startup failed:', err && err.message ? err.message : err);
    }
    process.exit(1);
});

// ── Self-Ping Keep-Alive (Render free-tier) ────────────────────────────────
// Pings /health every 4 minutes so Render never marks the service as inactive
// (free tier spins down after 15 min of no inbound requests).
// Set SELF_PING_ENABLED=false in your environment to disable.
(function startSelfPing() {
    if (String(process.env.SELF_PING_ENABLED || 'true').toLowerCase() === 'false') return;

    const SELF_PING_INTERVAL_MS = Number(process.env.SELF_PING_INTERVAL_MS || 4 * 60 * 1000); // default 4 min
    const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '';

    if (!RENDER_URL) {
        // No public URL configured — self-ping disabled (only runs meaningfully on cloud)
        return;
    }

    const pingUrl = RENDER_URL.replace(/\/$/, '') + '/health';

    function doPing() {
        try {
            const mod = pingUrl.startsWith('https') ? require('https') : require('http');
            const req = mod.get(pingUrl, { timeout: 10000 }, (res) => {
                // Consume response body so the socket is released
                res.resume();
                console.log(`[KeepAlive] Pinged ${pingUrl} → ${res.statusCode}`);
            });
            req.on('error', (err) => {
                console.warn(`[KeepAlive] Ping failed: ${err.message}`);
            });
            req.setTimeout(10000, () => {
                req.destroy();
            });
        } catch (e) {
            console.warn('[KeepAlive] Self-ping error:', e && e.message ? e.message : e);
        }
    }

    // Delay first ping by 30s so the server is fully up
    setTimeout(() => {
        doPing();
        setInterval(doPing, SELF_PING_INTERVAL_MS);
    }, 30 * 1000);

    console.log(`[KeepAlive] Self-ping enabled → ${pingUrl} every ${SELF_PING_INTERVAL_MS / 1000}s`);
})();


process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// expose server for cluster-run to inject connections
try { module.exports.server = server; } catch (e) { }
