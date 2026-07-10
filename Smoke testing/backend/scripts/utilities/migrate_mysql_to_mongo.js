const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { connectDB, mongoose } = require('../src/config/db');
const { setSequenceAtLeast } = require('../src/utils/sequence');
const User = require('../src/models/user.model');
const Conversation = require('../src/models/conversation.model');
const Message = require('../src/models/message.model');
const ConversationRead = require('../src/models/conversationRead.model');
const OtpRequest = require('../src/models/otpRequest.model');

function toNumber(value, fallback = null) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toDate(value, fallback = null) {
    if (!value) return fallback;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? fallback : d;
}

function parseBoolean(value) {
    return String(value || '').toLowerCase() === 'true';
}

function createMysqlPool() {
    const host = process.env.MYSQL_SOURCE_HOST || process.env.DB_HOST;
    const user = process.env.MYSQL_SOURCE_USER || process.env.DB_USER;
    const password = process.env.MYSQL_SOURCE_PASSWORD || process.env.DB_PASSWORD;
    const database = process.env.MYSQL_SOURCE_DB || process.env.DB_NAME;

    if (!host || !user || !database) {
        throw new Error('Missing MySQL source config. Set MYSQL_SOURCE_HOST/USER/PASSWORD/DB or DB_HOST/USER/PASSWORD/NAME');
    }

    return mysql.createPool({
        host,
        user,
        password,
        database,
        waitForConnections: true,
        connectionLimit: 5
    });
}

async function fetchAll(pool, tableName) {
    const [rows] = await pool.query(`SELECT * FROM ${tableName}`);
    return rows;
}

async function clearTargetCollections() {
    await Promise.all([
        User.deleteMany({}),
        Conversation.deleteMany({}),
        Message.deleteMany({}),
        ConversationRead.deleteMany({}),
        OtpRequest.deleteMany({}),
        mongoose.connection.collection('schema_migrations').deleteMany({}),
        mongoose.connection.collection('counters').deleteMany({})
    ]);
}

async function migrate() {
    const clearTarget = parseBoolean(process.env.MIGRATION_CLEAR_TARGET);
    const pool = createMysqlPool();

    try {
        await connectDB();

        if (clearTarget) {
            console.log('Clearing Mongo target collections...');
            await clearTargetCollections();
        }

        const [
            users,
            conversations,
            conversationParticipants,
            messages,
            conversationReads,
            otpRequests,
            schemaMigrations
        ] = await Promise.all([
            fetchAll(pool, 'users'),
            fetchAll(pool, 'conversations'),
            fetchAll(pool, 'conversation_participants'),
            fetchAll(pool, 'messages'),
            fetchAll(pool, 'conversation_reads'),
            fetchAll(pool, 'otp_requests'),
            fetchAll(pool, 'schema_migrations')
        ]);

        const participantMap = new Map();
        for (const row of conversationParticipants) {
            const conversationId = toNumber(row.conversation_id);
            const userId = toNumber(row.user_id);
            if (!conversationId || !userId) continue;

            if (!participantMap.has(conversationId)) {
                participantMap.set(conversationId, new Set());
            }
            participantMap.get(conversationId).add(userId);
        }

        if (users.length) {
            await User.bulkWrite(
                users.map((row) => ({
                    updateOne: {
                        filter: { id: toNumber(row.id) },
                        update: {
                            $set: {
                                id: toNumber(row.id),
                                email: row.email ? String(row.email).trim().toLowerCase() : null,
                                createdAt: toDate(row.created_at, new Date())
                            }
                        },
                        upsert: true
                    }
                }))
            );
        }

        if (conversations.length) {
            await Conversation.bulkWrite(
                conversations.map((row) => {
                    const id = toNumber(row.id);
                    const participants = Array.from(participantMap.get(id) || []);
                    return {
                        updateOne: {
                            filter: { id },
                            update: {
                                $set: {
                                    id,
                                    type: row.type || 'dm',
                                    participants,
                                    createdAt: toDate(row.created_at, new Date()),
                                    isArchived: Boolean(row.is_archived || false),
                                    deletedAt: toDate(row.deleted_at, null)
                                }
                            },
                            upsert: true
                        }
                    };
                })
            );
        }

        if (messages.length) {
            await Message.bulkWrite(
                messages.map((row) => ({
                    updateOne: {
                        filter: { id: toNumber(row.id) },
                        update: {
                            $set: {
                                id: toNumber(row.id),
                                conversationId: toNumber(row.conversation_id),
                                senderId: toNumber(row.sender_id),
                                content: String(row.content || ''),
                                createdAt: toDate(row.created_at, new Date()),
                                expiresAt: toDate(row.expires_at, new Date()),
                                clientMessageId: row.client_message_id || null
                            }
                        },
                        upsert: true
                    }
                }))
            );
        }

        if (conversationReads.length) {
            await ConversationRead.bulkWrite(
                conversationReads.map((row) => ({
                    updateOne: {
                        filter: {
                            conversationId: toNumber(row.conversation_id),
                            userId: toNumber(row.user_id)
                        },
                        update: {
                            $set: {
                                conversationId: toNumber(row.conversation_id),
                                userId: toNumber(row.user_id),
                                lastReadMessageId: toNumber(row.last_read_message_id, null),
                                updatedAt: toDate(row.updated_at, new Date())
                            }
                        },
                        upsert: true
                    }
                }))
            );
        }

        if (otpRequests.length) {
            await OtpRequest.bulkWrite(
                otpRequests.map((row) => ({
                    updateOne: {
                        filter: { email: String(row.email || '').trim().toLowerCase() },
                        update: {
                            $set: {
                                email: String(row.email || '').trim().toLowerCase(),
                                otpHash: String(row.otp_hash || ''),
                                expiresAt: toDate(row.expires_at, new Date())
                            }
                        },
                        upsert: true
                    }
                }))
            );
        }

        if (schemaMigrations.length) {
            await mongoose.connection.collection('schema_migrations').bulkWrite(
                schemaMigrations.map((row) => ({
                    updateOne: {
                        filter: { filename: String(row.filename) },
                        update: {
                            $set: {
                                id: toNumber(row.id),
                                filename: String(row.filename),
                                created_at: toDate(row.created_at, new Date())
                            }
                        },
                        upsert: true
                    }
                }))
            );
        }

        const maxUserId = users.reduce((max, row) => Math.max(max, toNumber(row.id, 0)), 0);
        const maxConversationId = conversations.reduce((max, row) => Math.max(max, toNumber(row.id, 0)), 0);
        const maxMessageId = messages.reduce((max, row) => Math.max(max, toNumber(row.id, 0)), 0);

        await Promise.all([
            setSequenceAtLeast('users', maxUserId),
            setSequenceAtLeast('conversations', maxConversationId),
            setSequenceAtLeast('messages', maxMessageId)
        ]);

        console.log('MySQL -> Mongo migration completed.');
        console.log(`users: ${users.length}`);
        console.log(`conversations: ${conversations.length}`);
        console.log(`conversation_participants merged: ${conversationParticipants.length}`);
        console.log(`messages: ${messages.length}`);
        console.log(`conversation_reads: ${conversationReads.length}`);
        console.log(`otp_requests: ${otpRequests.length}`);
        console.log(`schema_migrations: ${schemaMigrations.length}`);
    } finally {
        await pool.end();
        await mongoose.connection.close();
    }
}

migrate()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Migration failed:', err && err.message ? err.message : err);
        process.exit(1);
    });
