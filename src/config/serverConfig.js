const Message = require('../models/message.model');
const { validateJwtConfig, validateCookieConfig } = require('../utils/authToken');

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

async function ensureMessageTtlIndex() {
    const indexes = await Message.collection.indexes();
    const expiresIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);

    if (expiresIndex && typeof expiresIndex.expireAfterSeconds !== 'number') {
        await Message.collection.dropIndex(expiresIndex.name);
    }

    await Message.collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'expiresAt_ttl' }
    );
}

function getAllowedOrigins() {
    const raw = String(process.env.CORS_ORIGIN || '').trim();
    if (!raw) {
        return ['http://localhost:5173', 'http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

module.exports = {
    getRequiredEnv,
    validateRuntimeConfig,
    ensureMessageTtlIndex,
    getAllowedOrigins
};
