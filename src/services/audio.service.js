const cloudinary = require('cloudinary').v2;
const ConfessionPost = require('../models/confessionPost.model');

function envValue(name) {
    return String(process.env[name] || '').trim();
}

const FOLDER = String(process.env.CLOUDINARY_AUDIO_FOLDER || 'fm-audio').trim().replace(/^\/+|\/+$/g, '') || 'fm-audio';
const FILE_TTL_HOURS = Number(process.env.AUDIO_FILE_TTL_HOURS || 0);
const PLAY_URL_TTL_HOURS = Number(process.env.AUDIO_PLAY_URL_TTL_HOURS || 4);
const MAX_BYTES = Number(process.env.AUDIO_MAX_BYTES || 2000000);
const MAX_DURATION_SECONDS = Number(process.env.AUDIO_MAX_DURATION_SECONDS || 30);
const PITCH_OPTIONS = [-400, -350, -300, -250, 250, 300, 350, 400];

cloudinary.config({
    cloud_name: envValue('CLOUDINARY_CLOUD_NAME'),
    api_key: envValue('CLOUDINARY_API_KEY'),
    api_secret: envValue('CLOUDINARY_API_SECRET'),
    secure: true
});

function createAudioError(code, message, status = 400) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

function isEnabled() {
    return String(process.env.AUDIO_ENABLED || 'false').toLowerCase() === 'true';
}

function assertConfigured() {
    if (!isEnabled()) {
        throw createAudioError('AUDIO_DISABLED', 'Audio confessions are currently unavailable.', 503);
    }
    if (!envValue('CLOUDINARY_CLOUD_NAME') || !envValue('CLOUDINARY_API_KEY') || !envValue('CLOUDINARY_API_SECRET')) {
        throw createAudioError('AUDIO_NOT_CONFIGURED', 'Audio upload is not configured.', 503);
    }
}

function pickPitchShift() {
    return PITCH_OPTIONS[Math.floor(Math.random() * PITCH_OPTIONS.length)];
}

function getContextValue(context, key) {
    if (!context) return '';
    if (context.custom && context.custom[key] !== undefined) return String(context.custom[key]);
    if (context[key] !== undefined) return String(context[key]);
    return '';
}

function validatePublicId(publicId) {
    const value = String(publicId || '').trim();
    if (!value || !value.startsWith(`${FOLDER}/`)) {
        throw createAudioError('INVALID_AUDIO_REFERENCE', 'Invalid audio reference.', 400);
    }
    return value;
}

function generateUploadToken({ userId, roomId }) {
    assertConfigured();

    const uid = Number(userId);
    const rid = Number(roomId);
    if (!uid || !rid) {
        throw createAudioError('INVALID_AUDIO_UPLOAD_CONTEXT', 'Invalid audio upload context.', 400);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const pitchShift = pickPitchShift();
    const context = `roomId=${rid}|userId=${uid}|pitchShift=${pitchShift}|tokenTimestamp=${timestamp}`;
    const params = {
        type: 'authenticated',
        folder: FOLDER,
        allowed_formats: 'webm,ogg,mp3,mp4',
        use_filename: 'false',
        unique_filename: 'true',
        overwrite: 'false',
        timestamp,
        tags: `room_${rid},user_${uid}`,
        context
    };
    const signature = cloudinary.utils.api_sign_request(params, envValue('CLOUDINARY_API_SECRET'));

    return {
        signature,
        timestamp,
        apiKey: envValue('CLOUDINARY_API_KEY'),
        cloudName: envValue('CLOUDINARY_CLOUD_NAME'),
        folder: FOLDER,
        tags: params.tags,
        uploadParams: params,
        allowedFormats: ['webm', 'ogg', 'mp3', 'mp4'],
        maxBytes: MAX_BYTES,
        maxDurationSeconds: MAX_DURATION_SECONDS,
        pitchShift,
        context,
        uploadUrl: `https://api.cloudinary.com/v1_1/${envValue('CLOUDINARY_CLOUD_NAME')}/video/upload`
    };
}

async function verifyUploadedAudio({ publicId, userId, roomId, clientDuration = null }) {
    assertConfigured();
    const safePublicId = validatePublicId(publicId);
    const resource = await cloudinary.api.resource(safePublicId, {
        resource_type: 'video',
        type: 'authenticated',
        context: true,
        image_metadata: true
    });

    const tokenTimestamp = Number(getContextValue(resource.context, 'tokenTimestamp'));
    if (!tokenTimestamp) {
        throw createAudioError('INVALID_AUDIO_REFERENCE', 'Invalid audio reference.', 400);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - tokenTimestamp > 600) {
        throw createAudioError('EXPIRED_UPLOAD_TOKEN', 'Upload token has expired.', 400);
    }

    const cloudinaryDuration = Number(resource.duration || 0);
    const fallbackDuration = Number(clientDuration || 0);
    const duration = Number.isFinite(cloudinaryDuration) && cloudinaryDuration > 0
        ? cloudinaryDuration
        : fallbackDuration;
    const bytes = Number(resource.bytes || 0);
    const contextRoomId = Number(getContextValue(resource.context, 'roomId'));
    const contextUserId = Number(getContextValue(resource.context, 'userId'));
    const pitchShift = Number(getContextValue(resource.context, 'pitchShift'));

    if (contextRoomId !== Number(roomId) || contextUserId !== Number(userId)) {
        throw createAudioError('INVALID_AUDIO_REFERENCE', 'Invalid audio reference.', 400);
    }
    if (!PITCH_OPTIONS.includes(pitchShift)) {
        throw createAudioError('INVALID_AUDIO_REFERENCE', 'Invalid audio reference.', 400);
    }
    if (!Number.isFinite(duration) || duration < 1 || duration > MAX_DURATION_SECONDS) {
        throw createAudioError('INVALID_AUDIO_DURATION', 'Invalid audio duration.', 400);
    }
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_BYTES) {
        throw createAudioError('INVALID_AUDIO_SIZE', 'Invalid audio size.', 400);
    }

    const uploadedAt = resource.created_at ? new Date(resource.created_at) : new Date();
    const expiresAt = FILE_TTL_HOURS > 0
        ? new Date(uploadedAt.getTime() + FILE_TTL_HOURS * 3600000)
        : null;
    return {
        publicId: safePublicId,
        duration: Math.round(duration),
        mimeType: resource.format ? `audio/${resource.format}` : 'audio/webm',
        bytes,
        pitchShift,
        uploadedAt,
        expiresAt
    };
}

function generateSignedPlayUrl({ publicId, pitchShift, format = 'webm' }) {
    assertConfigured();
    const safePublicId = validatePublicId(publicId);
    const shift = Number(pitchShift);
    if (!PITCH_OPTIONS.includes(shift)) {
        throw createAudioError('INVALID_AUDIO_REFERENCE', 'Invalid audio reference.', 400);
    }

    const cleanFormat = String(format || 'webm').trim().replace(/^\./, '');
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + Math.max(1, PLAY_URL_TTL_HOURS) * 3600;
    return {
        url: cloudinary.url(`${safePublicId}.${cleanFormat}`, {
            resource_type: 'video',
            type: 'authenticated',
            sign_url: true,
            secure: true,
            expires_at: expiresAtSeconds
        }),
        expiresAt: new Date(expiresAtSeconds * 1000)
    };
}

async function deleteAudio(publicId) {
    assertConfigured();
    const safePublicId = validatePublicId(publicId);
    await Promise.allSettled([
        cloudinary.uploader.destroy(safePublicId, { resource_type: 'video', type: 'authenticated' }),
        cloudinary.uploader.destroy(safePublicId, { resource_type: 'video', type: 'upload' })
    ]);
    return { deleted: true };
}

async function deleteExpiredAudio({ limit = 100 } = {}) {
    if (!isEnabled()) return { deleted: 0 };

    const rows = await ConfessionPost.find({
        'audioMeta.expiresAt': { $lte: new Date() },
        'audioMeta.publicId': { $ne: null }
    })
        .select({ _id: 0, id: 1, audioMeta: 1 })
        .limit(Math.max(1, Math.min(250, Number(limit) || 100)))
        .lean();

    let deleted = 0;
    for (const row of rows) {
        const publicId = row && row.audioMeta && row.audioMeta.publicId;
        if (!publicId) continue;
        try {
            await deleteAudio(publicId);
            await ConfessionPost.updateOne(
                { id: Number(row.id), 'audioMeta.publicId': publicId },
                { $set: { 'audioMeta.publicId': null, updatedAt: new Date() } }
            );
            deleted += 1;
        } catch (err) {
            console.error('Failed to delete expired confession audio:', err && err.message ? err.message : err);
        }
    }

    return { deleted };
}

async function deleteOrphanAudio() {
    if (!isEnabled()) return { deleted: 0 };
    assertConfigured();

    let deletedCount = 0;
    const thresholdMs = 2 * 60 * 60 * 1000; // 2 hours
    const cutoff = new Date(Date.now() - thresholdMs);

    const types = ['authenticated', 'upload'];
    for (const deliveryType of types) {
        try {
            let nextCursor = null;
            do {
                const options = {
                    resource_type: 'video',
                    type: deliveryType,
                    prefix: `${FOLDER}/`,
                    max_results: 100
                };
                if (nextCursor) {
                    options.next_cursor = nextCursor;
                }

                const response = await cloudinary.api.resources(options);
                const resources = response.resources || [];
                nextCursor = response.next_cursor;

                for (const res of resources) {
                    const createdAt = new Date(res.created_at);
                    if (createdAt > cutoff) {
                        continue;
                    }

                    const exists = await ConfessionPost.exists({ 'audioMeta.publicId': res.public_id });
                    if (!exists) {
                        console.log(`[AudioExpiry] Deleting orphan audio (${deliveryType}): ${res.public_id}`);
                        await deleteAudio(res.public_id);
                        deletedCount++;
                    }
                }
            } while (nextCursor);
        } catch (err) {
            console.error(`[AudioExpiry] Failed to check orphan audio for type ${deliveryType}:`, err && err.message ? err.message : err);
        }
    }

    return { deleted: deletedCount };
}

module.exports = {
    generateUploadToken,
    verifyUploadedAudio,
    generateSignedPlayUrl,
    deleteAudio,
    deleteExpiredAudio,
    deleteOrphanAudio,
    validatePublicId
};
