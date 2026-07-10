const { connectDB } = require('../config/db');
const Message = require('../models/message.model');
const fs = require('fs');

const METRICS_DIR = 'metrics';
const PERSIST_LATENCY_CSV = `${METRICS_DIR}/persist_latency.csv`;
try { fs.mkdirSync(METRICS_DIR, { recursive: true }); } catch (e) {}
if (!fs.existsSync(PERSIST_LATENCY_CSV)) {
    try { fs.writeFileSync(PERSIST_LATENCY_CSV, 'timestamp,messageId,latencyMs\n'); } catch (e) {}
}

let dbConnected = false;
async function ensureDb() {
    if (dbConnected) return;
    await connectDB();
    dbConnected = true;
}

process.on('message', async (msg) => {
    try {
        if (!msg || !msg.type) return;
        if (msg.type === 'batch') {
            const { batch, enqueueTimes } = msg;
            if (!Array.isArray(batch) || batch.length === 0) {
                process.send && process.send({ type: 'acked', ids: [] });
                return;
            }

            await ensureDb();

            const ids = batch.map((b) => b && b.id).filter(Boolean);
            try {
                await Message.insertMany(batch, { ordered: false });
            } catch (err) {
                // log and continue to reconciliation
                try { console.error('worker insertMany error:', err && err.message ? err.message : err); } catch (e) {}
            }

            // reconcile clientMessageId via upsert for any missing documents
            try {
                const clientIds = batch.map((b) => b && b.clientMessageId).filter(Boolean);
                if (clientIds.length) {
                    const existing = await Message.find({ clientMessageId: { $in: clientIds } }).select({ clientMessageId: 1 }).lean();
                    const existingSet = new Set(existing.map((r) => r.clientMessageId));
                    const missing = batch.filter((d) => d && d.clientMessageId && !existingSet.has(d.clientMessageId));
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
                                try { console.error('worker reconcile bulkWrite error:', e && e.message ? e.message : e); } catch (e2) {}
                            }
                        }
                    }
                }
            } catch (e) {
                try { console.error('worker reconcile error:', e && e.message ? e.message : e); } catch (e2) {}
            }

            // fetch persisted rows to report back
            try {
                const found = await Message.find({ id: { $in: ids } }).select({ id: 1 }).lean();
                const foundIds = found.map((r) => r.id);
                process.send && process.send({ type: 'persisted', ids: foundIds, now: Date.now() });
            } catch (e) {
                try { console.error('worker fetch persisted ids error:', e && e.message ? e.message : e); } catch (e2) {}
                process.send && process.send({ type: 'persisted', ids: [], now: Date.now() });
            }
        } else if (msg.type === 'shutdown') {
            // graceful exit
            try {
                if (process.disconnect) process.disconnect();
            } catch (e) {}
            process.exit(0);
        }
    } catch (err) {
        try { console.error('persist.worker unhandled message error:', err); } catch (e) {}
    }
});

// keep the worker alive
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// heartbeat to master so it can monitor liveness
try {
    setInterval(() => {
        try {
            process.send && process.send({ type: 'heartbeat', ts: Date.now() });
        } catch (e) {}
    }, 2000);
} catch (e) {}
