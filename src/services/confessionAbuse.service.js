const crypto = require('crypto');
const ActionCounter = require('../models/actionCounter.model');
const ConfessionContentFingerprint = require('../models/confessionContentFingerprint.model');
const {
    makeFingerprintKey,
    mightHaveFingerprint,
    rememberFingerprint
} = require('./bloomFilter.service');

function createRateLimitError(retryAfterSec) {
    const err = new Error('Too many requests. Please wait and try again.');
    err.code = 'RATE_LIMITED';
    err.status = 429;
    err.retryAfterSec = Math.max(1, Math.ceil(Number(retryAfterSec) || 1));
    return err;
}

function normalizeContent(content) {
    return String(content || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '');
}

function hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function enforceActionLimit({ userId, action, maxActions, windowSec }) {
    const uid = Number(userId);
    const max = Number(maxActions);
    const window = Number(windowSec);

    if (!uid || !action || !Number.isFinite(max) || max <= 0 || !Number.isFinite(window) || window <= 0) {
        return;
    }

    const now = Date.now();
    const bucket = Math.floor(now / (window * 1000));
    const bucketStartMs = bucket * window * 1000;
    const bucketEndMs = bucketStartMs + window * 1000;

    const key = `${action}:${uid}:${bucket}`;
    const result = await ActionCounter.findOneAndUpdate(
        { key },
        {
            $inc: { count: 1 },
            $set: { expiresAt: new Date(bucketEndMs + 1000) }
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
        }
    ).lean();

    if (Number(result && result.count) > max) {
        const retryAfterSec = Math.max(1, Math.ceil((bucketEndMs - now) / 1000));
        throw createRateLimitError(retryAfterSec);
    }
}

async function detectSpamContent({ userId, roomId, type, content }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const normalized = normalizeContent(content);
    if (!uid || !rid || !normalized || normalized.length < 8) {
        return { isSpam: false, contentHash: hashContent(normalized || String(content || '')) };
    }

    const windowSecRaw = Number(process.env.CONFESSION_SPAM_WINDOW_SEC || 180);
    const duplicateLimitRaw = Number(process.env.CONFESSION_SPAM_DUPLICATE_LIMIT || 2);
    const windowSec = Number.isFinite(windowSecRaw) && windowSecRaw > 0 ? windowSecRaw : 180;
    const duplicateLimit = Number.isFinite(duplicateLimitRaw) && duplicateLimitRaw > 0 ? duplicateLimitRaw : 2;

    const contentHash = hashContent(normalized);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowSec * 1000);
    const fingerprintKey = makeFingerprintKey({ userId: uid, roomId: rid, type, hash: contentHash });

    if (!mightHaveFingerprint({ userId: uid, roomId: rid, type, hash: contentHash })) {
        try {
            await ConfessionContentFingerprint.create({
                userId: uid,
                roomId: rid,
                type,
                hash: contentHash,
                count: 1,
                firstSeenAt: now,
                lastSeenAt: now,
                expiresAt
            });
            rememberFingerprint({ userId: uid, roomId: rid, type, hash: contentHash });
            return {
                isSpam: false,
                contentHash
            };
        } catch (err) {
            if (!err || err.code !== 11000) {
                throw err;
            }
        }
    }

    const row = await ConfessionContentFingerprint.findOneAndUpdate(
        { userId: uid, roomId: rid, type, hash: contentHash },
        {
            $inc: { count: 1 },
            $set: { lastSeenAt: now, expiresAt },
            $setOnInsert: { firstSeenAt: now }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    rememberFingerprint({ userId: uid, roomId: rid, type, hash: contentHash });

    return {
        isSpam: Number(row && row.count) > duplicateLimit,
        contentHash
    };
}

module.exports = {
    enforceActionLimit,
    detectSpamContent
};
