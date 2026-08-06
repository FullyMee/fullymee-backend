const EventEmitter = require('events');

const ConfessionRoom = require('../models/confessionRoom.model');
const ConfessionRoomMember = require('../models/confessionRoomMember.model');
const ConfessionPost = require('../models/confessionPost.model');
const ConfessionLike = require('../models/confessionLike.model');
const ConfessionReply = require('../models/confessionReply.model');
const ConfessionReaction = require('../models/confessionReaction.model');
const ConfessionReport = require('../models/confessionReport.model');
const ConfessionModerationQueue = require('../models/confessionModerationQueue.model');
const ChatRequest = require('../models/chatRequest.model');
const User = require('../models/user.model');
const ReplyLike = require('../models/replyLike.model');

const { getNextSequence } = require('../utils/sequence');
const { generateUniqueAlias } = require('./confessionAlias.service');
const { moderateContent } = require('./confessionModeration.service');
const { enforceActionLimit, detectSpamContent } = require('./confessionAbuse.service');
const { incrementRoomMetric, getRoomMetricMap, getRoomMetricsSummary } = require('./confessionMetrics.service');
const { recommendRooms } = require('./confessionRecommendation.service');
const {
    mightHaveJoinCode,
    rememberJoinCode,
    rememberRoomAlias
} = require('./bloomFilter.service');
const conversationService = require('./conversation.service');
const audioService = require('./audio.service');

const emitter = new EventEmitter();
const MAX_AUDIO_DURATION_SECONDS = Number(process.env.AUDIO_MAX_DURATION_SECONDS || 30);

function normalizeCategory(value) {
    return String(value || 'general')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .slice(0, 50) || 'general';
}

function slug(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function generateSixDigitCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function getDefaultRoomCapacity() {
    const raw = Number(process.env.CONFESSION_ROOM_DEFAULT_CAPACITY || 100);
    return Number.isFinite(raw) && raw > 1 ? Math.min(100, Math.floor(raw)) : 100;
}

function getTimedRoomDurationMinutes() {
    const raw = Number(process.env.CONFESSION_TIMED_ROOM_DURATION_MIN || 240);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 240;
}

function getPublicRoomInactivityMinutes() {
    const raw = Number(process.env.CONFESSION_PUBLIC_ROOM_INACTIVITY_MIN || 20);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
}

function getReportHideThreshold() {
    const raw = Number(process.env.CONFESSION_REPORT_AUTO_HIDE_THRESHOLD || 3);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
}

function getRoomFamilyKey({ category, roomType, title }) {
    const categoryKey = normalizeCategory(category);
    const titleKey = slug(title) || 'default';
    return `${roomType}:${categoryKey}:${titleKey}`;
}

function createShardKey(category, date = new Date()) {
    const c = normalizeCategory(category);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const segment = Math.floor(date.getUTCHours() / 6);
    return `${c}:${year}${month}${day}:${segment}`;
}

function createServiceError(code, message, status = 400, meta = {}) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    Object.assign(err, meta || {});
    return err;
}

function getRateLimitConfig(action) {
    if (action === 'confession_post') {
        return {
            maxActions: Number(process.env.CONFESSION_POSTS_PER_MIN || 6),
            windowSec: 60
        };
    }
    if (action === 'confession_reply') {
        return {
            maxActions: Number(process.env.CONFESSION_REPLIES_PER_MIN || 12),
            windowSec: 60
        };
    }
    if (action === 'confession_react') {
        return {
            maxActions: Number(process.env.CONFESSION_REACTIONS_PER_MIN || 30),
            windowSec: 60
        };
    }
    if (action === 'confession_report') {
        return {
            maxActions: Number(process.env.CONFESSION_REPORTS_PER_HOUR || 20),
            windowSec: 3600
        };
    }
    return { maxActions: 20, windowSec: 60 };
}

function computeRankingScore({
    positiveReactionCount = 0,
    reactionCount = 0,
    replyCount = 0,
    createdAt = new Date(),
    lastEngagementAt = new Date()
}) {
    const now = Date.now();
    const createdMs = new Date(createdAt).getTime();
    const engagedMs = new Date(lastEngagementAt || createdAt).getTime();

    const ageHours = Math.max(1, (now - createdMs) / (1000 * 60 * 60));
    const engagementAgeHours = Math.max(1, (now - engagedMs) / (1000 * 60 * 60));

    const recency = 10 / Math.pow(ageHours + 2, 1.2);
    const engagementBoost = 4 / Math.pow(engagementAgeHours + 2, 1.1);

    return Number((
        positiveReactionCount * 3 +
        reactionCount * 1 +
        replyCount * 2 +
        recency +
        engagementBoost
    ).toFixed(4));
}

function computeTrendingRoomScore(room, metrics = {}, now = Date.now()) {
    const currentUserCount = Number(room && room.currentUserCount) || 0;
    const engagementRate = Number(room && room.engagementRate) || 0;
    const updatedAtMs = new Date((room && room.updatedAt) || (room && room.createdAt) || now).getTime();
    const ageHours = Math.max(1, (now - updatedAtMs) / (1000 * 60 * 60));
    const joins = Math.max(0, Number(metrics.joins) || 0);
    const leaves = Math.max(0, Number(metrics.leaves) || 0);
    const confessions = Math.max(0, Number(metrics.confessions) || 0);
    const replies = Math.max(0, Number(metrics.replies) || 0);
    const reactions = Math.max(0, Number(metrics.reactions) || 0);
    const totalSessionSeconds = Math.max(0, Number(metrics.totalSessionSeconds) || 0);

    const activityScore =
        Math.log1p(currentUserCount) * 4.2 +
        Math.log1p(confessions * 2 + replies * 1.25 + reactions * 0.75) * 3.1;
    const postingFrequencyScore = Math.log1p((confessions + replies) / ageHours) * 2.2;
    const sessionScore = Math.log1p(totalSessionSeconds / 60) * 0.7;
    const stabilityScore = Math.log1p(engagementRate * 10) * 1.3;
    const leaveRate = joins > 0 ? leaves / joins : (leaves > 0 ? 1 : 0);
    const leavePenalty = Math.log1p(leaveRate * 10) * 4.5;

    return Number((
        activityScore +
        postingFrequencyScore +
        sessionScore +
        stabilityScore -
        leavePenalty
    ).toFixed(4));
}

function computeLatestConfessionScore(post, now = Date.now()) {
    const createdAtMs = new Date((post && post.createdAt) || now).getTime();
    const ageMinutes = Math.max(1, (now - createdAtMs) / (1000 * 60));
    const reactionCount = Math.max(0, Number(post && post.reactionCount) || 0);
    const replyCount = Math.max(0, Number(post && post.replyCount) || 0);

    const freshnessScore = 12 / Math.pow(ageMinutes + 12, 1.15);
    const engagementScore = Math.log1p(reactionCount * 2 + replyCount * 3) * 2.4;

    return Number((freshnessScore + engagementScore).toFixed(4));
}

function sanitizeRoom(room, alias, { userId = null, includeJoinCode = false } = {}) {
    const safeRoom = {
        roomId: room.id,
        title: room.title,
        description: room.description,
        category: room.category,
        maxCapacity: room.maxCapacity,
        currentUserCount: room.currentUserCount,
        createdAt: room.createdAt,
        expiresAt: room.expiresAt || null,
        isActive: room.isActive,
        roomType: room.roomType,
        alias
    };

    safeRoom.isOwner = Number(userId) > 0 && Number(room.createdByUserId || 0) === Number(userId);

    if (includeJoinCode && room.roomType === 'private') {
        safeRoom.joinCode = room.joinCode || null;
    }

    return safeRoom;
}

function sanitizeConfession(post, viewerState = {}, avatar = null) {
    const audioMeta = post && post.audioMeta ? post.audioMeta : {};
    const hasAudio = !!audioMeta.publicId;
    return {
        confessionId: post.id,
        roomId: post.roomId,
        alias: post.alias,
        avatar: avatar || null,
        content: post.content || '',
        hasAudio,
        audio: hasAudio || audioMeta.duration ? {
            available: hasAudio,
            duration: audioMeta.duration || null,
            expiresAt: audioMeta.expiresAt || null,
            pitchShift: audioMeta.pitchShift || null
        } : null,
        createdAt: post.createdAt,
        reactionCount: post.likesCount || post.reactionCount || 0,
        likesCount: post.likesCount || 0,
        replyCount: post.replyCount,
        moderationStatus: post.moderationStatus,
        sentimentScore: post.sentimentScore,
        likedByViewer: !!viewerState.likedByViewer,
        viewerChatRequestStatus: viewerState.viewerChatRequestStatus || null
    };
}

async function cleanupAudioMeta(audioMeta) {
    const publicId = audioMeta && audioMeta.publicId;
    if (!publicId) return;
    try {
        await audioService.deleteAudio(publicId);
    } catch (err) {
        console.error('Failed to cleanup confession audio:', err && err.message ? err.message : err);
    }
}

function sanitizeReply(reply, viewerState = {}, avatar = null) {
    return {
        replyId: reply.id,
        confessionId: reply.confessionId,
        roomId: reply.roomId,
        alias: reply.alias,
        avatar: avatar || null,
        content: reply.content,
        parentReplyId: reply.parentReplyId || null,
        parentAlias: reply.parentAlias || null,
        createdAt: reply.createdAt,
        reactionCount: reply.reactionCount,
        moderationStatus: reply.moderationStatus,
        sentimentScore: reply.sentimentScore,
        likedByViewer: !!viewerState.likedByViewer
    };
}

async function attachAuthorAvatars(items) {
    if (!items || !items.length) return items;

    // items could be confessions or replies, they have 'author'
    const authorIds = [...new Set(items.map(item => Number(item.author)).filter(Boolean))];
    if (!authorIds.length) return items;

    const users = await User.find({ id: { $in: authorIds } }).select({ id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map();
    for (const u of users) {
        avatarMap.set(u.id, u.preferences?.avatar || '🌊');
    }

    for (const item of items) {
        if (item.author && avatarMap.has(Number(item.author))) {
            item.authorAvatar = avatarMap.get(Number(item.author));
        }
    }

    return items;
}

async function buildConfessionViewerStateMap({ userId, roomId, confessionIds = [] }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const ids = [...new Set((Array.isArray(confessionIds) ? confessionIds : []).map((value) => Number(value)).filter(Boolean))];
    const stateMap = new Map();

    if (!uid || !rid || !ids.length) {
        return stateMap;
    }

    const dbPosts = await ConfessionPost.find({ id: { $in: ids } }).select({ _id: 1, id: 1 }).lean();
    const objectIdToNumericId = new Map(dbPosts.map(p => [p._id.toString(), p.id]));
    const confessionObjectIds = dbPosts.map(p => p._id);

    const [likes, chatRequests] = await Promise.all([
        ConfessionLike.find({
            confessionId: { $in: confessionObjectIds },
            userId: uid
        })
            .select({ confessionId: 1 })
            .lean(),
        ChatRequest.find({
            roomId: rid,
            confessionId: { $in: ids },
            requesterUserId: uid,
            status: { $in: ['pending', 'accepted'] }
        })
            .sort({ createdAt: -1 })
            .select({ _id: 0, confessionId: 1, status: 1 })
            .lean()
    ]);

    for (const row of likes) {
        const numericId = objectIdToNumericId.get(row.confessionId.toString());
        if (!numericId) continue;
        stateMap.set(numericId, {
            ...(stateMap.get(numericId) || {}),
            likedByViewer: true
        });
    }

    for (const row of chatRequests) {
        const confessionId = Number(row && row.confessionId);
        if (!confessionId) continue;
        const existing = stateMap.get(confessionId) || {};
        if (!existing.viewerChatRequestStatus) {
            stateMap.set(confessionId, {
                ...existing,
                viewerChatRequestStatus: row.status || 'pending'
            });
        }
    }

    return stateMap;
}

async function buildReplyViewerStateMap({ userId, roomId, replyIds = [] }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const ids = [...new Set((Array.isArray(replyIds) ? replyIds : []).map((value) => Number(value)).filter(Boolean))];
    const stateMap = new Map();

    if (!uid || !rid || !ids.length) {
        return stateMap;
    }

    const dbReplies = await ConfessionReply.find({ id: { $in: ids } }).select({ _id: 1, id: 1 }).lean();
    const objectIdToNumericId = new Map(dbReplies.map(r => [r._id.toString(), r.id]));
    const replyObjectIds = dbReplies.map(r => r._id);

    const likes = await ReplyLike.find({
        replyId: { $in: replyObjectIds },
        userId: uid
    })
        .select({ replyId: 1 })
        .lean();

    for (const row of likes) {
        const numericId = objectIdToNumericId.get(row.replyId.toString());
        if (!numericId) continue;
        stateMap.set(numericId, { likedByViewer: true });
    }

    return stateMap;
}

function sanitizeRoomMember(member) {
    return {
        userId: Number(member.userId) || null,
        alias: String(member.alias || '').trim(),
        joinedAt: member.joinedAt || null,
        lastActiveAt: member.lastActiveAt || null
    };
}

function sanitizeModerationQueueItem(item) {
    return {
        queueId: item.id,
        roomId: item.roomId,
        targetType: item.targetType,
        targetId: item.targetId,
        severity: item.severity,
        categories: Array.isArray(item.categories) ? item.categories : [],
        action: item.action,
        reason: item.reason || null,
        contentSnapshot: item.contentSnapshot || null,
        escalationRequired: !!item.escalationRequired,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        resolvedAt: item.resolvedAt || null,
        resolvedByUserId: item.resolvedByUserId || null,
        resolutionAction: item.resolutionAction || null,
        resolutionReason: item.resolutionReason || null
    };
}

async function createModerationQueueItem({
    roomId,
    targetType,
    targetId = null,
    userId = null,
    alias = null,
    severity,
    categories = [],
    action,
    reason = null,
    contentSnapshot = null,
    escalationRequired = false
}) {
    const id = await getNextSequence('confession_moderation_queue');
    await ConfessionModerationQueue.create({
        id,
        roomId: Number(roomId) || null,
        targetType,
        targetId: Number(targetId) || null,
        userId: Number(userId) || null,
        alias,
        severity,
        categories,
        action,
        reason,
        contentSnapshot,
        escalationRequired
    });
    return id;
}

async function expireTimedRooms() {
    const now = new Date();
    const timedRooms = await ConfessionRoom.find({
        roomType: 'timed',
        isActive: true,
        expiresAt: { $ne: null, $lte: now }
    })
        .select({ _id: 0, id: 1 })
        .lean();

    if (!timedRooms.length) return 0;
    const ids = timedRooms.map((row) => Number(row.id)).filter(Boolean);

    await ConfessionRoom.updateMany(
        { id: { $in: ids } },
        {
            $set: {
                isActive: false,
                currentUserCount: 0,
                updatedAt: now
            }
        }
    );

    await ConfessionRoomMember.updateMany(
        { roomId: { $in: ids }, isActive: true },
        {
            $set: {
                isActive: false,
                leftAt: now,
                lastActiveAt: now
            }
        }
    );

    for (const roomId of ids) {
        emitter.emit('confession_room_expired', { roomId });
    }

    return ids.length;
}

async function expireInactivePublicRoomMembers() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - getPublicRoomInactivityMinutes() * 60 * 1000);

    const staleMembers = await ConfessionRoomMember.find({
        isActive: true,
        lastActiveAt: { $lte: cutoff }
    })
        .select({ _id: 0, roomId: 1, joinedAt: 1 })
        .lean();

    if (!staleMembers.length) return 0;

    const staleRoomIds = [...new Set(staleMembers.map((member) => Number(member && member.roomId)).filter(Boolean))];
    if (!staleRoomIds.length) return 0;

    const publicRooms = await ConfessionRoom.find({
        id: { $in: staleRoomIds },
        isActive: true,
        roomType: 'public',
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
        .select({ _id: 0, id: 1, currentUserCount: 1 })
        .lean();

    if (!publicRooms.length) return 0;

    const activePublicRoomIds = new Set(publicRooms.map((room) => Number(room && room.id)).filter(Boolean));
    const targetMembers = staleMembers.filter((member) => activePublicRoomIds.has(Number(member && member.roomId)));
    if (!targetMembers.length) return 0;

    await ConfessionRoomMember.updateMany(
        {
            roomId: { $in: [...activePublicRoomIds] },
            isActive: true,
            lastActiveAt: { $lte: cutoff }
        },
        {
            $set: {
                isActive: false,
                leftAt: now,
                lastActiveAt: now
            }
        }
    );

    const roomStats = new Map();
    for (const member of targetMembers) {
        const roomId = Number(member && member.roomId);
        if (!roomId) continue;

        const existing = roomStats.get(roomId) || { count: 0, totalSessionSeconds: 0 };
        existing.count += 1;
        existing.totalSessionSeconds += Math.max(
            1,
            Math.floor((now.getTime() - new Date(member.joinedAt || now).getTime()) / 1000)
        );
        roomStats.set(roomId, existing);
    }

    const updatedRoomCounts = new Map(publicRooms.map((room) => [Number(room.id), Number(room.currentUserCount || 0)]));
    for (const [roomId, stats] of roomStats.entries()) {
        await ConfessionRoom.updateOne(
            { id: roomId, currentUserCount: { $gt: 0 } },
            {
                $inc: { currentUserCount: -stats.count },
                $set: { updatedAt: now }
            }
        );

        const nextCount = Math.max(0, Number(updatedRoomCounts.get(roomId) || 0) - stats.count);
        updatedRoomCounts.set(roomId, nextCount);

        await incrementRoomMetric(
            roomId,
            { leaves: stats.count, totalSessionSeconds: stats.totalSessionSeconds },
            { snapshotActiveUsers: nextCount }
        );
        await updateRoomEngagementRate(roomId);

        emitter.emit('confession_room_left', {
            roomId,
            currentUserCount: nextCount
        });
    }

    return targetMembers.length;
}

async function getUserActiveRooms(userId) {
    return ConfessionRoomMember.find({ userId: Number(userId), isActive: true })
        .select({ _id: 0, roomId: 1, alias: 1, joinedAt: 1, lastActiveAt: 1 })
        .lean();
}

async function listRoomMembers({ userId = null, roomId }) {
    const rid = Number(roomId);
    if (!rid) {
        throw createServiceError('INVALID_ROOM', 'Invalid room id.', 400);
    }

    if (Number(userId) > 0) {
        await getRoomAndMembership({ userId: Number(userId), roomId: rid });
    }

    const members = await ConfessionRoomMember.find({
        roomId: rid,
        isActive: true
    })
        .select({ _id: 0, userId: 1, alias: 1, joinedAt: 1, lastActiveAt: 1 })
        .sort({ lastActiveAt: -1, joinedAt: -1, alias: 1 })
        .lean();

    const userIds = [...new Set(members.map(m => Number(m.userId)).filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: userIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    return members.map(member => {
        const safe = sanitizeRoomMember(member);
        safe.avatar = avatarMap.get(safe.userId) || null;
        return safe;
    });
}

async function reserveRoomSlot(roomId) {
    const now = new Date();
    return ConfessionRoom.findOneAndUpdate(
        {
            id: Number(roomId),
            isActive: true,
            $expr: { $lt: ['$currentUserCount', '$maxCapacity'] },
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
        },
        {
            $inc: { currentUserCount: 1 },
            $set: { updatedAt: now }
        },
        {
            new: true
        }
    )
        .select({ _id: 0 })
        .lean();
}

async function createRoomInstance({
    category,
    roomType = 'public',
    title = '',
    description = '',
    tags = [],
    maxCapacity = null,
    joinCode = null,
    expiresAt = null,
    createdByUserId = null,
    initialUserCount = 0
}) {
    const now = new Date();
    const normalizedCategory = normalizeCategory(category);
    const normalizedRoomType = roomType === 'private' ? 'private' : (roomType === 'timed' ? 'timed' : 'public');
    const roomTitle = String(title || '').trim() || `${normalizedCategory} room`;
    const roomFamilyKey = getRoomFamilyKey({
        category: normalizedCategory,
        roomType: normalizedRoomType,
        title: roomTitle
    });

    const existingLatest = await ConfessionRoom.findOne({ roomFamilyKey })
        .sort({ roomInstance: -1 })
        .select({ _id: 0, roomInstance: 1 })
        .lean();

    const roomInstance = Number(existingLatest && existingLatest.roomInstance ? existingLatest.roomInstance : 0) + 1;
    const roomId = await getNextSequence('confession_rooms');
    const capacity = Number(maxCapacity) > 1 ? Math.floor(Number(maxCapacity)) : getDefaultRoomCapacity();

    let roomExpiresAt = expiresAt ? new Date(expiresAt) : null;
    if (normalizedRoomType === 'timed' && !roomExpiresAt) {
        roomExpiresAt = new Date(now.getTime() + getTimedRoomDurationMinutes() * 60 * 1000);
    }

    const roomDoc = await ConfessionRoom.create({
        id: roomId,
        shardKey: createShardKey(normalizedCategory, now),
        title: roomTitle,
        description: String(description || '').trim(),
        category: normalizedCategory,
        tags: (Array.isArray(tags) ? tags : []).map((v) => normalizeCategory(v)),
        roomFamilyKey,
        roomInstance,
        maxCapacity: capacity,
        currentUserCount: Math.max(0, Number(initialUserCount) || 0),
        roomType: normalizedRoomType,
        joinCode: normalizedRoomType === 'private' ? String(joinCode || '').trim() || null : null,
        createdByUserId: Number(createdByUserId) || null,
        isActive: true,
        expiresAt: roomExpiresAt,
        createdAt: now,
        updatedAt: now
    });

    if (roomDoc && roomDoc.joinCode) {
        rememberJoinCode(roomDoc.joinCode);
    }

    return roomDoc.toObject({ versionKey: false });
}

async function pickCandidateRoom({ category, roomType }) {
    const now = new Date();
    const normalizedCategory = normalizeCategory(category);
    const normalizedRoomType = roomType === 'private' ? 'private' : (roomType === 'timed' ? 'timed' : 'public');
    if (normalizedRoomType === 'private') return null;

    const candidates = await ConfessionRoom.find({
        isActive: true,
        category: normalizedCategory,
        roomType: normalizedRoomType,
        $expr: { $lt: ['$currentUserCount', '$maxCapacity'] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
        .select({ _id: 0 })
        .sort({ currentUserCount: -1, engagementRate: -1, createdAt: 1 })
        .limit(50)
        .lean();

    if (!candidates.length) return null;
    const withUsers = candidates.filter((row) => Number(row.currentUserCount || 0) > 0);
    const preferred = withUsers.length ? withUsers : candidates;
    return preferred[0];
}

async function getRoomAndMembership({ userId, roomId }) {
    const uid = Number(userId);
    const rid = Number(roomId);

    const member = await ConfessionRoomMember.findOne({ userId: uid, roomId: rid, isActive: true })
        .select({ _id: 0, alias: 1, joinedAt: 1, lastActiveAt: 1 })
        .lean();
    if (!member) {
        throw createServiceError('ROOM_NOT_JOINED', 'Join the room first to continue.', 403);
    }

    const room = await ConfessionRoom.findOne({
        id: rid,
        isActive: true,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
    })
        .select({ _id: 0 })
        .lean();
    if (!room) {
        throw createServiceError('ROOM_INACTIVE', 'This room is no longer active.', 410);
    }

    await ConfessionRoomMember.updateOne(
        { userId: uid, roomId: rid, isActive: true },
        { $set: { lastActiveAt: new Date() } }
    );

    return { room, member };
}

async function updateRoomEngagementRate(roomId) {
    const summary = await getRoomMetricsSummary(roomId, new Date(Date.now() - 2 * 60 * 60 * 1000), new Date());
    if (!summary) return;

    const room = await ConfessionRoom.findOne({ id: Number(roomId) })
        .select({ _id: 0, currentUserCount: 1 })
        .lean();
    if (!room) return;

    const interactions = summary.confessions * 2 + summary.replies * 1.5 + summary.reactions * 0.8;
    const participants = Math.max(1, Number(room.currentUserCount || 0));
    const engagementRate = Number((interactions / participants).toFixed(4));
    const averageSessionSec = summary.leaves > 0
        ? Number((summary.totalSessionSeconds / summary.leaves).toFixed(2))
        : 0;

    await ConfessionRoom.updateOne(
        { id: Number(roomId) },
        { $set: { engagementRate, averageSessionSec, updatedAt: new Date() } }
    );
}

async function joinRoom({
    userId,
    roomId = null,
    title = '',
    description = '',
    category = 'general',
    roomType = 'public',
    maxCapacity = null,
    tags = [],
    expiresAt = null,
    joinSource = 'algorithm',
    allowPrivateRoom = false
}) {
    const uid = Number(userId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);

    const requestedRoomId = Number(roomId) || null;
    if (requestedRoomId) {
        const activeMember = await ConfessionRoomMember.findOne({
            userId: uid,
            roomId: requestedRoomId,
            isActive: true
        })
            .select({ _id: 0, alias: 1 })
            .lean();

        if (activeMember) {
            const existingRoom = await ConfessionRoom.findOne({
                id: requestedRoomId,
                isActive: true,
                $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
            })
                .select({ _id: 0 })
                .lean();
            if (existingRoom) {
                return sanitizeRoom(existingRoom, activeMember.alias, {
                    userId: uid,
                    includeJoinCode: true
                });
            }
        }
    }

    let selectedRoom = null;
    let slotReserved = false;

    if (requestedRoomId) {
        const now = new Date();
        const roomMeta = await ConfessionRoom.findOne({ id: requestedRoomId })
            .select({ _id: 0, roomType: 1, createdByUserId: 1, isActive: 1, expiresAt: 1 })
            .lean();
        if (!roomMeta) {
            throw createServiceError('ROOM_NOT_FOUND', 'Room not found.', 404);
        }
        if (!roomMeta.isActive || (roomMeta.expiresAt && new Date(roomMeta.expiresAt) <= now)) {
            throw createServiceError('ROOM_INACTIVE', 'This room is no longer active.', 410);
        }
        if (
            roomMeta.roomType === 'private' &&
            !allowPrivateRoom &&
            Number(roomMeta.createdByUserId || 0) !== uid
        ) {
            throw createServiceError('PRIVATE_ROOM_FORBIDDEN', 'You are not allowed to join this private room.', 403);
        }

        selectedRoom = await reserveRoomSlot(requestedRoomId);
        if (!selectedRoom) {
            throw createServiceError(
                'ROOM_FULL',
                `This ${roomMeta.roomType === 'private' ? 'private ' : ''}room has reached the 100 member limit.`,
                409
            );
        }
        slotReserved = true;
    } else {
        if (roomType === 'private') {
            throw createServiceError('PRIVATE_ROOM_CREATE_REQUIRED', 'Create a private room first to generate a join code.', 400);
        }

        const candidate = await pickCandidateRoom({ category, roomType });
        if (candidate) {
            const reserved = await reserveRoomSlot(candidate.id);
            if (reserved) {
                selectedRoom = reserved;
                slotReserved = true;
            }
        }

        if (!selectedRoom) {
            selectedRoom = await createRoomInstance({
                category,
                roomType,
                title,
                description,
                tags,
                maxCapacity,
                expiresAt,
                initialUserCount: 1,
                createdByUserId: roomType === 'private' ? uid : null
            });
        }
    }

    const existingMembership = await ConfessionRoomMember.findOne({
        roomId: selectedRoom.id,
        userId: uid
    })
        .select({ _id: 0, alias: 1, isActive: 1 })
        .lean();

    let alias = '';
    if (existingMembership && existingMembership.isActive) {
        alias = existingMembership.alias;
        if (slotReserved) {
            await ConfessionRoom.updateOne(
                { id: selectedRoom.id, currentUserCount: { $gt: 0 } },
                { $inc: { currentUserCount: -1 } }
            );
        }
    } else if (existingMembership) {
        alias = existingMembership.alias;
        await ConfessionRoomMember.updateOne(
            { roomId: selectedRoom.id, userId: uid },
            {
                $set: {
                    isActive: true,
                    leftAt: null,
                    lastActiveAt: new Date(),
                    joinedAt: new Date(),
                    joinSource
                }
            }
        );
    } else {
        const userRec = await User.findOne({ id: uid }).select('username').lean();
        alias = userRec && userRec.username ? userRec.username : `User${uid}`;
        try {
            await ConfessionRoomMember.create({
                roomId: selectedRoom.id,
                userId: uid,
                alias,
                isActive: true,
                joinedAt: new Date(),
                lastActiveAt: new Date(),
                joinSource
            });
            rememberRoomAlias(selectedRoom.id, alias);
        } catch (err) {
            await ConfessionRoom.updateOne(
                { id: selectedRoom.id, currentUserCount: { $gt: 0 } },
                { $inc: { currentUserCount: -1 } }
            );
            throw createServiceError('ROOM_JOIN_FAILED', 'Unable to join the room.', 500, { originalError: err });
        }
    }

    await incrementRoomMetric(selectedRoom.id, { joins: 1 }, { snapshotActiveUsers: selectedRoom.currentUserCount });
    await updateRoomEngagementRate(selectedRoom.id);

    const safeRoom = sanitizeRoom(selectedRoom, alias, {
        userId: uid,
        includeJoinCode: true
    });
    emitter.emit('confession_room_joined', { roomId: safeRoom.roomId, currentUserCount: safeRoom.currentUserCount });
    return safeRoom;
}

async function generateUniquePrivateJoinCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const code = generateSixDigitCode();
        if (!mightHaveJoinCode(code)) return code;
        const existing = await ConfessionRoom.findOne({ joinCode: code })
            .select({ _id: 0, id: 1 })
            .lean();
        if (!existing) return code;
    }

    throw createServiceError('JOIN_CODE_GENERATION_FAILED', 'Unable to generate a private room code right now.', 500);
}

async function createRoom({
    userId,
    title,
    description = '',
    category = 'general',
    roomType = 'public',
    joinCode = null
}) {
    const uid = Number(userId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);

    const normalizedType = roomType === 'private' ? 'private' : 'public';
    const roomTitle = String(title || '').trim();
    const roomDescription = String(description || '').trim();
    const roomCategory = String(category || '').trim() || 'general';
    const customJoinCode = normalizedType === 'private' ? String(joinCode || '').trim() : '';
    let lastError = null;

    if (normalizedType === 'private' && customJoinCode && !/^\d{6}$/.test(customJoinCode)) {
        throw createServiceError('INVALID_JOIN_CODE', 'Enter a valid 6 digit code.', 400);
    }

    if (normalizedType === 'private' && customJoinCode) {
        let existingCode = null;
        if (mightHaveJoinCode(customJoinCode)) {
            existingCode = await ConfessionRoom.findOne({ joinCode: customJoinCode })
                .select({ _id: 0, id: 1 })
                .lean();
        }
        if (existingCode) {
            throw createServiceError('JOIN_CODE_ALREADY_EXISTS', 'This join code is already in use. Try another one.', 409);
        }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const effectiveJoinCode = normalizedType === 'private'
            ? (customJoinCode || await generateUniquePrivateJoinCode())
            : null;

        try {
            const createdRoom = await createRoomInstance({
                category: roomCategory,
                roomType: normalizedType,
                title: roomTitle,
                description: roomDescription,
                maxCapacity: getDefaultRoomCapacity(),
                joinCode: effectiveJoinCode,
                createdByUserId: uid,
                initialUserCount: 0
            });

            return joinRoom({
                userId: uid,
                roomId: createdRoom.id,
                joinSource: normalizedType === 'private' ? 'private_room_create' : 'public_room_create',
                allowPrivateRoom: normalizedType === 'private'
            });
        } catch (err) {
            lastError = err;
            if (err && err.code === 11000) {
                if (customJoinCode) {
                    throw createServiceError('JOIN_CODE_ALREADY_EXISTS', 'This join code is already in use. Try another one.', 409);
                }
                continue;
            }
            throw err;
        }
    }

    if (lastError) throw lastError;
    throw createServiceError('ROOM_CREATE_FAILED', 'Unable to create the room right now.', 500);
}

async function joinRoomByCode({ userId, code, joinSource = 'private_code' }) {
    const uid = Number(userId);
    const joinCode = String(code || '').trim();
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);
    if (!/^\d{6}$/.test(joinCode)) {
        throw createServiceError('INVALID_JOIN_CODE', 'Enter a valid 6 digit code.', 400);
    }

    let room = null;
    if (mightHaveJoinCode(joinCode)) {
        room = await ConfessionRoom.findOne({
            joinCode,
            roomType: 'private',
            isActive: true,
            $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
        })
            .select({ _id: 0, id: 1 })
            .lean();
    }

    if (!room) {
        throw createServiceError('PRIVATE_ROOM_NOT_FOUND', 'No private room was found for that code.', 404);
    }

    const existingActiveMembership = await ConfessionRoomMember.findOne({
        roomId: Number(room.id),
        userId: uid,
        isActive: true
    })
        .select({ _id: 0, roomId: 1 })
        .lean();

    if (existingActiveMembership) {
        throw createServiceError('PRIVATE_ROOM_ALREADY_JOINED', 'You have already joined this private room.', 409);
    }

    return joinRoom({
        userId: uid,
        roomId: room.id,
        joinSource,
        allowPrivateRoom: true
    });
}

async function leaveRoom({ userId, roomId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    if (!uid || !rid) {
        throw createServiceError('INVALID_INPUT', 'Invalid room.', 400);
    }

    const roomMeta = await ConfessionRoom.findOne({ id: rid, isActive: true })
        .select({ _id: 0, roomType: 1 })
        .lean();

    if (!roomMeta) {
        throw createServiceError('ROOM_NOT_FOUND', 'Room not found.', 404);
    }

    const member = await ConfessionRoomMember.findOne({
        userId: uid,
        roomId: rid,
        isActive: true
    })
        .select({ _id: 0, joinedAt: 1 })
        .lean();

    if (!member) {
        return { left: false };
    }

    const now = new Date();
    const sessionSeconds = Math.max(1, Math.floor((now.getTime() - new Date(member.joinedAt).getTime()) / 1000));

    await ConfessionRoomMember.updateOne(
        { userId: uid, roomId: rid, isActive: true },
        { $set: { isActive: false, leftAt: now, lastActiveAt: now } }
    );

    await ConfessionRoom.updateOne(
        { id: rid, currentUserCount: { $gt: 0 } },
        { $inc: { currentUserCount: -1 }, $set: { updatedAt: now } }
    );

    const room = await ConfessionRoom.findOne({ id: rid }).select({ _id: 0, currentUserCount: 1 }).lean();
    await incrementRoomMetric(
        rid,
        { leaves: 1, totalSessionSeconds: sessionSeconds },
        { snapshotActiveUsers: Number(room && room.currentUserCount ? room.currentUserCount : 0) }
    );
    await updateRoomEngagementRate(rid);

    emitter.emit('confession_room_left', { roomId: rid, currentUserCount: Number(room && room.currentUserCount ? room.currentUserCount : 0) });
    return { left: true };
}

async function listMyRooms({ userId }) {
    const uid = Number(userId);
    const memberships = await ConfessionRoomMember.find({ userId: uid, isActive: true })
        .select({ _id: 0, roomId: 1, alias: 1, joinedAt: 1 })
        .lean();

    if (!memberships.length) return [];
    const roomIds = memberships.map((row) => row.roomId);

    const rooms = await ConfessionRoom.find({
        id: { $in: roomIds },
        isActive: true
    })
        .select({ _id: 0 })
        .lean();

    const roomMap = new Map(rooms.map((room) => [room.id, room]));
    return memberships
        .map((member) => {
            const room = roomMap.get(member.roomId);
            if (!room) return null;
            return {
                ...sanitizeRoom(room, member.alias, { userId: uid, includeJoinCode: true }),
                joinedAt: member.joinedAt
            };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.joinedAt || 0).getTime() - new Date(a.joinedAt || 0).getTime());
}

async function listPublicRooms({ limit = 100, offset = 0, sortBy = 'discover', search = '' } = {}) {
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 100;
    const off = Number.isFinite(Number(offset)) ? Math.max(0, Math.floor(Number(offset))) : 0;
    const normalizedSearch = String(search || '').trim();
    const now = new Date();
    const query = {
        isActive: true,
        roomType: 'public',
        $expr: { $lt: ['$currentUserCount', '$maxCapacity'] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    };

    if (normalizedSearch) {
        query.$and = [{
            $or: [
                { title: { $regex: normalizedSearch, $options: 'i' } },
                { description: { $regex: normalizedSearch, $options: 'i' } },
                { category: { $regex: normalizedSearch, $options: 'i' } }
            ]
        }];
    }

    const selectFields = {
        _id: 0,
        id: 1,
        title: 1,
        description: 1,
        category: 1,
        maxCapacity: 1,
        currentUserCount: 1,
        roomType: 1,
        createdAt: 1,
        updatedAt: 1,
        expiresAt: 1,
        isActive: 1,
        engagementRate: 1
    };

    let rooms;
    if (sortBy === 'trending') {
        const roomRows = await ConfessionRoom.find(query)
            .select(selectFields)
            .lean();

        const metricsMap = await getRoomMetricMap(roomRows.map((room) => room.id), 180);
        rooms = roomRows
            .map((room) => {
                const metrics = metricsMap.get(Number(room.id)) || {};
                return {
                    ...room,
                    _trendingScore: computeTrendingRoomScore(room, metrics, now.getTime())
                };
            })
            .sort((a, b) => {
                if ((b._trendingScore || 0) !== (a._trendingScore || 0)) {
                    return (b._trendingScore || 0) - (a._trendingScore || 0);
                }
                if ((Number(b.currentUserCount) || 0) !== (Number(a.currentUserCount) || 0)) {
                    return (Number(b.currentUserCount) || 0) - (Number(a.currentUserCount) || 0);
                }
                const updatedDiff = new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
                if (updatedDiff !== 0) return updatedDiff;
                return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
            })
            .slice(off, off + lim);
    } else {
        const sort = { currentUserCount: -1, createdAt: -1 };
        rooms = await ConfessionRoom.find(query)
            .select(selectFields)
            .sort(sort)
            .skip(off)
            .limit(lim)
            .lean();
    }

    return rooms.map((room) => ({
        ...sanitizeRoom(room, null),
        score: sortBy === 'trending'
            ? Number((room._trendingScore || 0).toFixed(4))
            : Number(((Number(room.engagementRate || 0) * 10) + Number(room.currentUserCount || 0)).toFixed(4))
    }));
}

async function listMyConfessions({ userId, limit = 50 }) {
    const uid = Number(userId);
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;

    const memberships = await ConfessionRoomMember.find({ userId: uid })
        .select({ _id: 0, roomId: 1, alias: 1 })
        .lean();

    if (!memberships.length) return [];

    const conditions = memberships
        .map((member) => ({
            roomId: Number(member && member.roomId),
            alias: String((member && member.alias) || '')
        }))
        .filter((item) => Number.isInteger(item.roomId) && item.roomId > 0 && item.alias);

    if (!conditions.length) return [];

    const posts = await ConfessionPost.find({
        $or: conditions,
        isPublished: true,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0 })
        .sort({ createdAt: -1 })
        .limit(lim)
        .lean();

    const roomIds = [...new Set(posts.map((post) => Number(post && post.roomId)).filter(Boolean))];
    const rooms = roomIds.length
        ? await ConfessionRoom.find({ id: { $in: roomIds } })
            .select({ _id: 0, id: 1, title: 1, category: 1, currentUserCount: 1 })
            .lean()
        : [];

    const roomMap = new Map(rooms.map((room) => [Number(room.id), room]));
    const viewerStateByRoom = new Map();
    const postsByRoom = new Map();

    for (const post of posts) {
        const rid = Number(post && post.roomId);
        if (!rid) continue;
        if (!postsByRoom.has(rid)) {
            postsByRoom.set(rid, []);
        }
        postsByRoom.get(rid).push(Number(post.id));
    }

    const stateEntries = await Promise.all(
        [...postsByRoom.entries()].map(async ([rid, confessionIds]) => ([
            rid,
            await buildConfessionViewerStateMap({ userId: uid, roomId: rid, confessionIds })
        ]))
    );
    for (const [rid, stateMap] of stateEntries) {
        viewerStateByRoom.set(rid, stateMap);
    }

    const userIds = [...new Set(posts.map(p => Number(p.author)).filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: userIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    return posts.map((post) => {
        const room = roomMap.get(Number(post.roomId)) || null;
        const viewerState = (viewerStateByRoom.get(Number(post.roomId)) || new Map()).get(Number(post.id)) || {};
        return {
            ...sanitizeConfession(post, viewerState, avatarMap.get(Number(post.author))),
            roomTitle: room && room.title ? room.title : 'Room',
            roomCategory: room && room.category ? room.category : 'general',
            roomMemberCount: room && Number.isFinite(Number(room.currentUserCount)) ? Number(room.currentUserCount) : 0
        };
    });
}

async function postConfession({ userId, roomId, content, scheduledAt = null, audioPublicId = null, audioDuration = null }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const text = String(content || '').trim();
    const audioId = String(audioPublicId || '').trim();
    if (!text) throw createServiceError('EMPTY_CONTENT', 'Confession content or audio title is required.', 400);

    const MIN_SCHEDULE_MS = 5 * 60 * 1000;
    const MAX_SCHEDULE_MS = 7 * 24 * 60 * 60 * 1000;
    let scheduledDate = null;
    if (scheduledAt) {
        scheduledDate = new Date(scheduledAt);
        if (isNaN(scheduledDate.getTime())) {
            throw createServiceError('INVALID_SCHEDULED_AT', 'Scheduled time is invalid.', 400);
        }
        const msFromNow = scheduledDate.getTime() - Date.now();
        if (msFromNow < MIN_SCHEDULE_MS) {
            throw createServiceError('SCHEDULE_TOO_SOON', 'Scheduled time must be at least 5 minutes in the future.', 400);
        }
        if (msFromNow > MAX_SCHEDULE_MS) {
            throw createServiceError('SCHEDULE_TOO_FAR', 'Scheduled time cannot be more than 7 days in the future.', 400);
        }
    }

    const { room, member } = await getRoomAndMembership({ userId: uid, roomId: rid });

    const postRate = getRateLimitConfig('confession_post');
    await enforceActionLimit({ userId: uid, action: 'confession_post', ...postRate });

    let audioMeta = null;
    if (audioId) {
        audioMeta = await audioService.verifyUploadedAudio({
            publicId: audioId,
            userId: uid,
            roomId: rid,
            clientDuration: audioDuration
        });
        if (!audioMeta || Number(audioMeta.duration || 0) < 1 || Number(audioMeta.duration || 0) > MAX_AUDIO_DURATION_SECONDS) {
            throw createServiceError('INVALID_AUDIO', 'Invalid audio duration.', 400);
        }
    }

    const spamResult = await detectSpamContent({
        userId: uid,
        roomId: rid,
        type: 'confession',
        content: text || `audio:${audioId}`
    });
    if (spamResult.isSpam) {
        await cleanupAudioMeta(audioMeta);
        throw createServiceError('SPAM_DETECTED', 'Please avoid repeating the same content.', 429);
    }

    const moderation = moderateContent(text);
    if (moderation.action === 'block') {
        await cleanupAudioMeta(audioMeta);
        await createModerationQueueItem({
            roomId: rid,
            targetType: 'confession',
            userId: uid,
            alias: member.alias,
            severity: moderation.severity,
            categories: moderation.categories,
            action: 'escalate',
            reason: moderation.reasons.join(', '),
            contentSnapshot: text,
            escalationRequired: true
        });

        await incrementRoomMetric(rid, { blocks: 1 });

        throw createServiceError(
            'CONFESSION_BLOCKED',
            moderation.userWarning || 'Your confession could not be published due to safety policy.',
            422
        );
    }

    const now = new Date();
    const confessionId = await getNextSequence('confession_posts');
    const rankingScore = computeRankingScore({ createdAt: now, lastEngagementAt: now });

    const post = await ConfessionPost.create({
        id: confessionId,
        shardKey: createShardKey(room.category, now),
        roomId: rid,
        alias: member.alias,
        content: text,
        audioMeta,
        author: uid,
        likesCount: 0,
        contentHash: spamResult.contentHash,
        moderationStatus: moderation.moderationStatus,
        moderationSeverity: moderation.severity,
        moderationReasons: moderation.reasons,
        sentimentScore: moderation.sentimentScore,
        rankingScore,
        isHidden: false,
        isPublished: scheduledDate ? false : true,
        scheduleStatus: scheduledDate ? 'pending' : null,
        scheduledAt: scheduledDate || null,
        publishedAt: scheduledDate ? null : now,
        confirmExpiresAt: null,
        createdAt: now,
        updatedAt: now,
        lastEngagementAt: now
    });

    if (moderation.action === 'flag') {
        await createModerationQueueItem({
            roomId: rid,
            targetType: 'confession',
            targetId: confessionId,
            userId: uid,
            alias: member.alias,
            severity: moderation.severity,
            categories: moderation.categories,
            action: 'flag',
            reason: moderation.reasons.join(', '),
            contentSnapshot: text
        });

        await incrementRoomMetric(rid, { flags: 1 });
    }

    await attachAuthorAvatars([post]);
    const safePost = sanitizeConfession(post);

    if (scheduledDate) {
        return {
            confession: null,
            scheduled: {
                confessionId,
                scheduledAt: scheduledDate,
                alias: member.alias,
                content: text,
                audio: audioMeta ? {
                    available: true,
                    duration: audioMeta.duration || null,
                    expiresAt: audioMeta.expiresAt || null,
                    pitchShift: audioMeta.pitchShift || null
                } : null
            },
            moderationWarning: moderation.action === 'flag' ? moderation.userWarning : ''
        };
    }

    await incrementRoomMetric(rid, { confessions: 1 });
    await updateRoomEngagementRate(rid);

    emitter.emit('confession_created', { roomId: rid, confession: safePost });
    return {
        confession: safePost,
        scheduled: null,
        moderationWarning: moderation.action === 'flag' ? moderation.userWarning : ''
    };
}

async function listConfessions({ userId, roomId, limit = 50, sortBy = 'ranked' }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;

    await getRoomAndMembership({ userId: uid, roomId: rid });

    const posts = await ConfessionPost.find({
        roomId: rid,
        isPublished: true,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0 })
        .sort(
            sortBy === 'latest'
                ? { createdAt: -1, reactionCount: -1, replyCount: -1, rankingScore: -1 }
                : sortBy === 'top'
                    ? { reactionCount: -1, replyCount: -1, createdAt: -1 }
                    : { rankingScore: -1, createdAt: -1 }
        )
        .limit(lim)
        .lean();

    const viewerStateMap = await buildConfessionViewerStateMap({
        userId: uid,
        roomId: rid,
        confessionIds: posts.map((post) => Number(post && post.id))
    });

    const userIds = [...new Set(posts.map(p => Number(p.author)).filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: userIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    if (sortBy === 'latest') {
        const scored = posts.map((post) => ({
            ...sanitizeConfession(post, viewerStateMap.get(Number(post.id)) || {}, avatarMap.get(Number(post.author))),
            _latestScore: computeLatestConfessionScore(post)
        }));
        return scored
            .sort((a, b) => {
                if ((b._latestScore || 0) !== (a._latestScore || 0)) {
                    return (b._latestScore || 0) - (a._latestScore || 0);
                }
                return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
            })
            .map(({ _latestScore, ...rest }) => rest);
    }

    return posts.map((post) => sanitizeConfession(post, viewerStateMap.get(Number(post.id)) || {}, avatarMap.get(Number(post.author))));
}

async function getAudioUploadToken({ userId, roomId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);
    await getRoomAndMembership({ userId: uid, roomId: rid });
    return audioService.generateUploadToken({ userId: uid, roomId: rid });
}

async function getConfessionAudioUrl({ userId, roomId, confessionId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const cid = Number(confessionId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);
    await getRoomAndMembership({ userId: uid, roomId: rid });

    const post = await ConfessionPost.findOne({
        id: cid,
        roomId: rid,
        isPublished: true,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0, id: 1, audioMeta: 1 })
        .lean();

    if (!post) {
        throw createServiceError('CONFESSION_NOT_FOUND', 'Confession not found.', 404);
    }

    const audioMeta = post.audioMeta || {};
    if (!audioMeta.publicId) {
        throw createServiceError('AUDIO_NOT_AVAILABLE', 'Audio is no longer available.', 410);
    }
    if (audioMeta.expiresAt && new Date(audioMeta.expiresAt).getTime() <= Date.now()) {
        throw createServiceError('AUDIO_NOT_AVAILABLE', 'Audio is no longer available.', 410);
    }

    let format = 'webm';
    if (audioMeta.mimeType) {
        const parts = audioMeta.mimeType.split('/');
        if (parts.length === 2) {
            format = parts[1];
            if (format === 'mpeg') format = 'mp3'; // audio/mpeg -> mp3
        }
    }

    return audioService.generateSignedPlayUrl({
        publicId: audioMeta.publicId,
        pitchShift: audioMeta.pitchShift,
        format
    });
}

async function postReply({ userId, roomId, confessionId, content, parentReplyId = null, parentAlias = null }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const cid = Number(confessionId);
    const pReplyId = parentReplyId ? Number(parentReplyId) : null;
    const pAlias = parentAlias ? String(parentAlias).trim() : null;
    const text = String(content || '').trim();
    if (!text) throw createServiceError('EMPTY_CONTENT', 'Reply content is required.', 400);

    const { room, member } = await getRoomAndMembership({ userId: uid, roomId: rid });
    const confession = await ConfessionPost.findOne({
        id: cid,
        roomId: rid,
        isPublished: true,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0, id: 1, replyCount: 1, createdAt: 1, reactionCount: 1, positiveReactionCount: 1 })
        .lean();

    if (!confession) {
        throw createServiceError('CONFESSION_NOT_FOUND', 'Confession not found.', 404);
    }

    const replyRate = getRateLimitConfig('confession_reply');
    await enforceActionLimit({ userId: uid, action: 'confession_reply', ...replyRate });

    const spamResult = await detectSpamContent({
        userId: uid,
        roomId: rid,
        type: 'reply',
        content: text
    });
    if (spamResult.isSpam) {
        throw createServiceError('SPAM_DETECTED', 'Please avoid repeating the same content.', 429);
    }

    const moderation = moderateContent(text);
    if (moderation.action === 'block') {
        await createModerationQueueItem({
            roomId: rid,
            targetType: 'reply',
            targetId: cid,
            userId: uid,
            alias: member.alias,
            severity: moderation.severity,
            categories: moderation.categories,
            action: 'escalate',
            reason: moderation.reasons.join(', '),
            contentSnapshot: text,
            escalationRequired: true
        });
        await incrementRoomMetric(rid, { blocks: 1 });

        throw createServiceError(
            'REPLY_BLOCKED',
            moderation.userWarning || 'Your reply could not be published due to safety policy.',
            422
        );
    }

    const now = new Date();
    const replyId = await getNextSequence('confession_replies');
    const rankingScore = computeRankingScore({ createdAt: now, lastEngagementAt: now });

    const reply = await ConfessionReply.create({
        id: replyId,
        shardKey: createShardKey(room.category, now),
        roomId: rid,
        confessionId: cid,
        alias: member.alias,
        content: text,
        parentReplyId: pReplyId,
        parentAlias: pAlias,
        contentHash: spamResult.contentHash,
        author: uid,
        likesCount: 0,
        moderationStatus: moderation.moderationStatus,
        moderationSeverity: moderation.severity,
        moderationReasons: moderation.reasons,
        sentimentScore: moderation.sentimentScore,
        rankingScore,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
        lastEngagementAt: now
    });

    const nextReplyCount = Number(confession.replyCount || 0) + 1;
    const confessionRanking = computeRankingScore({
        positiveReactionCount: confession.positiveReactionCount || 0,
        reactionCount: confession.reactionCount || 0,
        replyCount: nextReplyCount,
        createdAt: confession.createdAt,
        lastEngagementAt: now
    });

    await ConfessionPost.updateOne(
        { id: cid, roomId: rid },
        {
            $inc: { replyCount: 1 },
            $set: { lastEngagementAt: now, rankingScore: confessionRanking, updatedAt: now }
        }
    );

    if (moderation.action === 'flag') {
        await createModerationQueueItem({
            roomId: rid,
            targetType: 'reply',
            targetId: replyId,
            userId: uid,
            alias: member.alias,
            severity: moderation.severity,
            categories: moderation.categories,
            action: 'flag',
            reason: moderation.reasons.join(', '),
            contentSnapshot: text
        });
        await incrementRoomMetric(rid, { flags: 1 });
    }

    await incrementRoomMetric(rid, { replies: 1 });
    await updateRoomEngagementRate(rid);

    const safeReply = sanitizeReply(reply);
    emitter.emit('confession_reply_created', { roomId: rid, confessionId: cid, reply: safeReply });
    return {
        reply: safeReply,
        moderationWarning: moderation.action === 'flag' ? moderation.userWarning : ''
    };
}

async function listReplies({ userId, roomId, confessionId, limit = 50 }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const cid = Number(confessionId);
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;

    await getRoomAndMembership({ userId: uid, roomId: rid });

    const replies = await ConfessionReply.find({
        roomId: rid,
        confessionId: cid,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0 })
        .sort({ rankingScore: -1, createdAt: -1 })
        .limit(lim)
        .lean();

    const viewerStateMap = await buildReplyViewerStateMap({
        userId: uid,
        roomId: rid,
        replyIds: replies.map((reply) => Number(reply && reply.id))
    });

    const userIds = [...new Set(replies.map(r => Number(r.author)).filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: userIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    return replies.map((reply) => sanitizeReply(reply, viewerStateMap.get(Number(reply.id)) || {}, avatarMap.get(Number(reply.author))));
}

async function reactToTarget({ userId, roomId, targetType, targetId, reactionType }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const tid = Number(targetId);
    const tType = targetType === 'reply' ? 'reply' : 'confession';

    await getRoomAndMembership({ userId: uid, roomId: rid });
    const reactionRate = getRateLimitConfig('confession_react');
    await enforceActionLimit({ userId: uid, action: 'confession_react', ...reactionRate });

    const model = tType === 'reply' ? ConfessionReply : ConfessionPost;
    const targetQuery = {
        id: tid,
        roomId: rid,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    };
    if (tType === 'confession') {
        targetQuery.isPublished = true;
    }

    const target = await model.findOne(targetQuery)
        .select({ _id: 0, id: 1, reactionCount: 1, replyCount: 1, createdAt: 1 })
        .lean();
    if (!target) {
        throw createServiceError('TARGET_NOT_FOUND', 'Target content not found.', 404);
    }

    const existing = await ConfessionReaction.findOne({
        roomId: rid,
        targetType: tType,
        targetId: tid,
        userId: uid
    }).lean();

    let reactionActive = true;
    if (!existing) {
        const reactionId = await getNextSequence('confession_reactions');
        await ConfessionReaction.create({
            id: reactionId,
            roomId: rid,
            targetType: tType,
            targetId: tid,
            userId: uid,
            reactionType
        });
    } else if (existing.reactionType === reactionType) {
        await ConfessionReaction.deleteOne({ id: existing.id });
        reactionActive = false;
    } else {
        await ConfessionReaction.updateOne(
            { id: existing.id },
            { $set: { reactionType } }
        );
    }

    const reactionCount = await ConfessionReaction.countDocuments({
        roomId: rid,
        targetType: tType,
        targetId: tid
    });

    const now = new Date();
    const rankingScore = computeRankingScore({
        positiveReactionCount: reactionCount,
        reactionCount,
        replyCount: Number(target.replyCount || 0),
        createdAt: target.createdAt,
        lastEngagementAt: now
    });

    await model.updateOne(
        { id: tid, roomId: rid },
        {
            $set: {
                reactionCount,
                positiveReactionCount: reactionCount,
                rankingScore,
                lastEngagementAt: now,
                updatedAt: now
            }
        }
    );

    await incrementRoomMetric(rid, { reactions: 1 });
    await updateRoomEngagementRate(rid);

    emitter.emit('confession_reaction_updated', {
        roomId: rid,
        targetType: tType,
        targetId: tid,
        reactionCount,
        reactionActive
    });

    return { targetType: tType, targetId: tid, reactionCount, reactionActive };
}

async function sendChatRequestForConfession({ userId, roomId, confessionId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const cid = Number(confessionId);

    const { member } = await getRoomAndMembership({ userId: uid, roomId: rid });

    const confession = await ConfessionPost.findOne({
        id: cid,
        roomId: rid,
        isPublished: true,
        isHidden: false,
        moderationStatus: { $in: ['approved', 'flagged'] }
    })
        .select({ _id: 0, alias: 1, content: 1 })
        .lean();

    if (!confession) {
        throw createServiceError('CONFESSION_NOT_FOUND', 'Confession not found.', 404);
    }

    const targetMember = await ConfessionRoomMember.findOne({
        roomId: rid,
        alias: confession.alias
    })
        .select({ _id: 0, userId: 1, alias: 1 })
        .lean();

    if (!targetMember || !Number(targetMember.userId)) {
        throw createServiceError('CONFESSION_AUTHOR_NOT_FOUND', 'Unable to send a request for this confession.', 404);
    }

    if (Number(targetMember.userId) === uid) {
        throw createServiceError('CHAT_REQUEST_TO_SELF', 'You cannot send a chat request to your own confession.', 409);
    }

    const result = await conversationService.createChatRequest({
        requesterUserId: uid,
        targetUserId: Number(targetMember.userId),
        requesterAlias: member.alias,
        targetAlias: targetMember.alias,
        roomId: rid,
        confessionId: cid,
        contextType: 'confession',
        contextPreview: confession.content
    });

    return {
        confessionId: cid,
        targetAlias: targetMember.alias,
        conversationId: Number(result && result.conversationId) || null,
        requestState: result && result.requestState ? result.requestState : 'sent'
    };
}

async function reportTarget({ userId, roomId, targetType, targetId, reason }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const tid = Number(targetId);
    const tType = targetType === 'reply' ? 'reply' : 'confession';
    const reportReason = String(reason || '').trim();
    if (reportReason.length < 3) {
        throw createServiceError('INVALID_REASON', 'Please provide a valid report reason.', 400);
    }

    const { member } = await getRoomAndMembership({ userId: uid, roomId: rid });
    const reportRate = getRateLimitConfig('confession_report');
    await enforceActionLimit({ userId: uid, action: 'confession_report', ...reportRate });

    const model = tType === 'reply' ? ConfessionReply : ConfessionPost;
    const targetQuery = {
        id: tid,
        roomId: rid
    };
    if (tType === 'confession') {
        targetQuery.isPublished = true;
    }

    const target = await model.findOne(targetQuery)
        .select({ _id: 0, id: 1, reportCount: 1, isHidden: 1 })
        .lean();
    if (!target) {
        throw createServiceError('TARGET_NOT_FOUND', 'Target content not found.', 404);
    }

    const reportId = await getNextSequence('confession_reports');
    try {
        await ConfessionReport.create({
            id: reportId,
            roomId: rid,
            targetType: tType,
            targetId: tid,
            reporterUserId: uid,
            reason: reportReason
        });
    } catch (err) {
        if (err && err.code === 11000) {
            throw createServiceError('ALREADY_REPORTED', 'You have already reported this content.', 409);
        }
        throw err;
    }

    const reportCount = Number(target.reportCount || 0) + 1;
    const threshold = getReportHideThreshold();
    const shouldHide = reportCount >= threshold;

    const updateSet = { reportCount, updatedAt: new Date() };
    if (shouldHide && !target.isHidden) {
        updateSet.isHidden = true;
        updateSet.hiddenReason = 'community_reports';
    }

    await model.updateOne({ id: tid, roomId: rid }, { $set: updateSet });

    await createModerationQueueItem({
        roomId: rid,
        targetType: tType,
        targetId: tid,
        userId: uid,
        alias: member.alias,
        severity: shouldHide ? 'red' : 'yellow',
        categories: ['community_report'],
        action: shouldHide ? 'escalate' : 'flag',
        reason: reportReason,
        escalationRequired: shouldHide
    });

    await incrementRoomMetric(rid, {
        reports: 1,
        flags: 1,
        blocks: shouldHide ? 1 : 0
    });

    if (shouldHide && !target.isHidden) {
        emitter.emit('confession_content_hidden', {
            roomId: rid,
            targetType: tType,
            targetId: tid,
            reason: 'community_reports'
        });
    }

    return {
        status: 'reported',
        reportCount,
        autoHidden: shouldHide
    };
}

async function getRecommendations({ userId, limit = 3, roomType = 'public' }) {
    const user = await User.findOne({ id: Number(userId) })
        .select({ _id: 0, interests: 1 })
        .lean();
    const interests = Array.isArray(user && user.interests) ? user.interests : [];

    return recommendRooms({
        interests,
        limit: Number(limit) || 3,
        roomType
    });
}

async function getAnalyticsSummary({ userId = null, roomId, from = null, to = null }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    if (!rid) {
        throw createServiceError('INVALID_ROOM', 'Invalid room id.', 400);
    }

    if (uid > 0) {
        await getRoomAndMembership({ userId: uid, roomId: rid });
    }

    const summary = await getRoomMetricsSummary(rid, from, to);
    const engagementEvents = summary.confessions + summary.replies + summary.reactions;
    const contentEvents = summary.confessions + summary.replies;

    return {
        roomId: rid,
        from: from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000),
        to: to ? new Date(to) : new Date(),
        engagementRate: Number((engagementEvents / Math.max(1, summary.joins)).toFixed(4)),
        averageSessionTimeSec: Number((summary.totalSessionSeconds / Math.max(1, summary.leaves)).toFixed(2)),
        flagRate: Number((summary.flags / Math.max(1, contentEvents)).toFixed(4)),
        blockRate: Number((summary.blocks / Math.max(1, contentEvents)).toFixed(4)),
        retentionImpact: Number((summary.joins > 0 ? (1 - summary.leaves / summary.joins) : 0).toFixed(4)),
        raw: summary
    };
}

function getModerationTargetModel(targetType) {
    if (targetType === 'confession') return ConfessionPost;
    if (targetType === 'reply') return ConfessionReply;
    return null;
}

function buildModerationContentUpdate(action) {
    if (action === 'approve') {
        return {
            isHidden: false,
            hiddenReason: null,
            moderationStatus: 'approved',
            moderationSeverity: 'green'
        };
    }

    if (action === 'hide') {
        return {
            isHidden: true,
            hiddenReason: 'moderator_hidden'
        };
    }

    if (action === 'block') {
        return {
            isHidden: true,
            hiddenReason: 'moderator_blocked',
            moderationStatus: 'blocked',
            moderationSeverity: 'red'
        };
    }

    return null;
}

async function listModerationQueue({
    status = 'pending',
    severity = 'all',
    targetType = 'all',
    limit = 50
} = {}) {
    const lim = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(100, Number(limit))) : 50;
    const query = {};

    if (status && status !== 'all') {
        query.status = status;
    }

    if (severity && severity !== 'all') {
        query.severity = severity;
    }

    if (targetType && targetType !== 'all') {
        query.targetType = targetType;
    }

    const [totalCount, rows] = await Promise.all([
        ConfessionModerationQueue.countDocuments(query),
        ConfessionModerationQueue.aggregate([
            { $match: query },
            {
                $addFields: {
                    severityRank: {
                        $switch: {
                            branches: [
                                { case: { $eq: ['$severity', 'red'] }, then: 3 },
                                { case: { $eq: ['$severity', 'yellow'] }, then: 2 },
                                { case: { $eq: ['$severity', 'green'] }, then: 1 }
                            ],
                            default: 0
                        }
                    }
                }
            },
            {
                $sort: {
                    escalationRequired: -1,
                    severityRank: -1,
                    createdAt: 1
                }
            },
            { $limit: lim },
            { $project: { _id: 0, severityRank: 0 } }
        ])
    ]);

    return {
        totalCount,
        items: rows.map(sanitizeModerationQueueItem)
    };
}

async function resolveModerationQueueItem({
    moderatorUserId,
    queueId,
    resolutionAction,
    resolutionReason = null
}) {
    const qid = Number(queueId);
    const moderatorId = Number(moderatorUserId);
    if (!Number.isInteger(qid) || qid <= 0) {
        throw createServiceError('INVALID_MODERATION_QUEUE', 'Invalid moderation queue id.', 400);
    }

    const queueItem = await ConfessionModerationQueue.findOne({ id: qid })
        .select({ _id: 0 })
        .lean();

    if (!queueItem) {
        throw createServiceError('MODERATION_ITEM_NOT_FOUND', 'Moderation queue item not found.', 404);
    }

    if (queueItem.status === 'resolved') {
        throw createServiceError('MODERATION_ITEM_ALREADY_RESOLVED', 'Moderation queue item is already resolved.', 409);
    }

    let targetUpdated = false;
    const targetModel = getModerationTargetModel(queueItem.targetType);
    const targetUpdate = buildModerationContentUpdate(resolutionAction);

    if (targetModel && targetUpdate && Number(queueItem.targetId) > 0) {
        const targetResult = await targetModel.updateOne(
            {
                id: Number(queueItem.targetId),
                roomId: Number(queueItem.roomId)
            },
            { $set: { ...targetUpdate, updatedAt: new Date() } }
        );
        targetUpdated = Number(targetResult.modifiedCount || 0) > 0;
    }

    const now = new Date();
    const resolutionPayload = {
        status: 'resolved',
        resolvedAt: now,
        updatedAt: now,
        resolvedByUserId: Number.isInteger(moderatorId) && moderatorId > 0 ? moderatorId : null,
        resolutionAction,
        resolutionReason: resolutionReason || null
    };

    const updateQueueResult = await ConfessionModerationQueue.updateOne(
        { id: qid, status: { $ne: 'resolved' } },
        { $set: resolutionPayload }
    );

    if (Number(updateQueueResult.modifiedCount || 0) === 0) {
        throw createServiceError('MODERATION_RESOLUTION_CONFLICT', 'Moderation queue item is already resolved.', 409);
    }

    const updatedItem = await ConfessionModerationQueue.findOne({ id: qid })
        .select({ _id: 0 })
        .lean();

    return {
        item: sanitizeModerationQueueItem(updatedItem),
        targetUpdated
    };
}

async function touchMemberActivity({ userId, roomId }) {
    await ConfessionRoomMember.updateOne(
        { roomId: Number(roomId), userId: Number(userId), isActive: true },
        { $set: { lastActiveAt: new Date() } }
    );
}

async function shuffleAlias({ userId, roomId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);
    if (!rid) throw createServiceError('INVALID_ROOM', 'Invalid room id.', 400);

    const member = await ConfessionRoomMember.findOne({ userId: uid, roomId: rid, isActive: true })
        .select({ _id: 0, alias: 1, shuffleCount: 1, lastShuffledAt: 1 })
        .lean();
    if (!member) {
        throw createServiceError('ROOM_NOT_JOINED', 'Join the room first to continue.', 403);
    }

    const now = new Date();
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const MAX_SHUFFLES_PER_DAY = 3;

    let nextShuffleCount = 1;
    if (member.lastShuffledAt && new Date(member.lastShuffledAt) > windowStart) {
        if (Number(member.shuffleCount || 0) >= MAX_SHUFFLES_PER_DAY) {
            const retryAfterSec = Math.ceil(
                (new Date(member.lastShuffledAt).getTime() - windowStart.getTime()) / 1000
            );
            const err = createServiceError(
                'SHUFFLE_RATE_LIMITED',
                'You have reached the limit of 3 identity shuffles per day in this room.',
                429
            );
            err.retryAfterSec = retryAfterSec;
            throw err;
        }
        nextShuffleCount = Number(member.shuffleCount || 0) + 1;
    }

    const oldAlias = member.alias;
    let newAlias = null;
    let updated = false;
    let lastErr = null;

    for (let attempt = 0; attempt < 6 && !updated; attempt++) {
        newAlias = await generateUniqueAlias(rid);
        try {
            await ConfessionRoomMember.updateOne(
                { userId: uid, roomId: rid, isActive: true },
                { $set: { alias: newAlias, shuffleCount: nextShuffleCount, lastShuffledAt: now } }
            );
            updated = true;
            rememberRoomAlias(rid, newAlias);
        } catch (err) {
            lastErr = err;
            if (err && err.code === 11000) continue;
            throw err;
        }
    }

    if (!updated) {
        throw createServiceError(
            'ALIAS_GENERATION_FAILED',
            'Unable to generate a unique alias. Please try again.',
            500
        );
    }

    emitter.emit('confession_room_member_shuffled', { roomId: rid, userId: uid, oldAlias, newAlias });
    return { alias: newAlias };
}

async function publishScheduledConfession(post) {
    const now = new Date();
    const rid = Number(post.roomId);
    const rankingScore = computeRankingScore({ createdAt: now, lastEngagementAt: now });
    const publishedPost = await ConfessionPost.findOneAndUpdate(
        { id: post.id, isPublished: false },
        {
            $set: {
                isPublished: true,
                scheduleStatus: null,
                publishedAt: now,
                confirmExpiresAt: null,
                createdAt: now,
                lastEngagementAt: now,
                rankingScore,
                updatedAt: now
            }
        },
        { new: true, projection: { _id: 0 } }
    ).lean();

    if (!publishedPost) {
        return null;
    }

    await incrementRoomMetric(rid, { confessions: 1 });
    await updateRoomEngagementRate(rid);

    await attachAuthorAvatars([publishedPost]);
    const safePost = sanitizeConfession(publishedPost);
    emitter.emit('confession_created', { roomId: rid, confession: safePost });
    return safePost;
}

async function listMyScheduledConfessions({ userId, roomId }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    if (!uid) throw createServiceError('INVALID_USER', 'Invalid user', 401);
    if (!rid) throw createServiceError('INVALID_ROOM', 'Invalid room id.', 400);

    await getRoomAndMembership({ userId: uid, roomId: rid });

    const posts = await ConfessionPost.find({
        author: uid,
        roomId: rid,
        isPublished: false,
        scheduleStatus: { $in: ['pending', 'confirming'] }
    })
        .select({ _id: 0, id: 1, content: 1, alias: 1, scheduledAt: 1, scheduleStatus: 1, confirmExpiresAt: 1, createdAt: 1, audioMeta: 1 })
        .sort({ scheduledAt: 1 })
        .lean();

    return posts.map((post) => ({
        confessionId: post.id,
        content: post.content,
        alias: post.alias,
        scheduledAt: post.scheduledAt,
        scheduleStatus: post.scheduleStatus,
        confirmExpiresAt: post.confirmExpiresAt || null,
        createdAt: post.createdAt,
        audio: post.audioMeta && (post.audioMeta.publicId || post.audioMeta.duration) ? {
            available: !!post.audioMeta.publicId,
            duration: post.audioMeta.duration || null,
            expiresAt: post.audioMeta.expiresAt || null,
            pitchShift: post.audioMeta.pitchShift || null
        } : null
    }));
}

async function confirmPublishConfession({ userId, confessionId, roomId }) {
    const uid = Number(userId);
    const cid = Number(confessionId);
    const rid = Number(roomId);

    const post = await ConfessionPost.findOne({
        id: cid,
        roomId: rid,
        author: uid,
        isPublished: false,
        scheduleStatus: 'confirming'
    })
        .select({ _id: 0 })
        .lean();

    if (!post) {
        throw createServiceError('SCHEDULED_CONFESSION_NOT_FOUND', 'Scheduled confession not found or already published.', 404);
    }

    return publishScheduledConfession(post);
}

async function cancelScheduledConfession({ userId, confessionId, roomId }) {
    const uid = Number(userId);
    const cid = Number(confessionId);
    const rid = Number(roomId);

    const post = await ConfessionPost.findOne({
        id: cid,
        roomId: rid,
        author: uid,
        isPublished: false,
        scheduleStatus: { $in: ['pending', 'confirming'] }
    })
        .select({ _id: 0, id: 1, audioMeta: 1 })
        .lean();

    if (!post) {
        throw createServiceError('SCHEDULED_CONFESSION_NOT_FOUND', 'Scheduled confession not found or already published.', 404);
    }

    const result = await ConfessionPost.updateOne(
        {
            id: cid,
            roomId: rid,
            author: uid,
            isPublished: false,
            scheduleStatus: { $in: ['pending', 'confirming'] }
        },
        { $set: { scheduleStatus: 'cancelled', updatedAt: new Date() } }
    );

    if (Number(result.modifiedCount || 0) === 0) {
        throw createServiceError('SCHEDULED_CONFESSION_NOT_FOUND', 'Scheduled confession not found or already published.', 404);
    }

    await cleanupAudioMeta(post.audioMeta);
    return { cancelled: true, confessionId: cid };
}

async function publishDueScheduledConfessions(getOnlineUsers) {
    const now = new Date();
    const CONFIRM_WINDOW_MS = Number(process.env.SCHEDULE_CONFIRM_WINDOW_MS || 5 * 60 * 1000);
    const confirmExpiresAt = new Date(now.getTime() + CONFIRM_WINDOW_MS);
    let published = 0;
    let notified = 0;

    // Phase 1: pending → confirming (online) or publish (offline)
    const pendingPosts = await ConfessionPost.find({
        isPublished: false,
        scheduleStatus: 'pending',
        scheduledAt: { $lte: now }
    })
        .select({
            _id: 0, id: 1, roomId: 1, author: 1, alias: 1, content: 1, scheduledAt: 1, audioMeta: 1,
            shardKey: 1, contentHash: 1, moderationStatus: 1, moderationSeverity: 1,
            moderationReasons: 1, sentimentScore: 1, rankingScore: 1, isHidden: 1,
            likesCount: 1, replyCount: 1, reactionCount: 1, createdAt: 1, updatedAt: 1
        })
        .lean();

    const onlineUsers = typeof getOnlineUsers === 'function' ? getOnlineUsers() : null;

    for (const post of pendingPosts) {
        const isOnline = onlineUsers && onlineUsers.has(Number(post.author));
        if (isOnline) {
            await ConfessionPost.updateOne(
                { id: post.id, isPublished: false, scheduleStatus: 'pending' },
                { $set: { scheduleStatus: 'confirming', confirmExpiresAt, updatedAt: now } }
            );
            emitter.emit('confession_scheduled_fired', {
                userId: Number(post.author),
                confessionId: post.id,
                roomId: Number(post.roomId),
                content: post.content,
                audio: post.audioMeta && (post.audioMeta.publicId || post.audioMeta.duration) ? {
                    available: !!post.audioMeta.publicId,
                    duration: post.audioMeta.duration || null,
                    expiresAt: post.audioMeta.expiresAt || null
                } : null,
                scheduledAt: post.scheduledAt,
                confirmExpiresAt
            });
            notified++;
        } else {
            const publishedPost = await publishScheduledConfession(post);
            if (publishedPost) {
                published++;
            }
        }
    }

    // Phase 2: confirming with expired window → auto-publish
    const expiredConfirming = await ConfessionPost.find({
        isPublished: false,
        scheduleStatus: 'confirming',
        confirmExpiresAt: { $lte: now }
    })
        .select({
            _id: 0, id: 1, roomId: 1, author: 1, alias: 1, content: 1, scheduledAt: 1,
            shardKey: 1, contentHash: 1, moderationStatus: 1, moderationSeverity: 1,
            moderationReasons: 1, sentimentScore: 1, rankingScore: 1, isHidden: 1,
            likesCount: 1, replyCount: 1, reactionCount: 1, createdAt: 1, updatedAt: 1
        })
        .lean();

    for (const post of expiredConfirming) {
        const publishedPost = await publishScheduledConfession(post);
        if (publishedPost) {
            published++;
        }
    }

    return { published, notified };
}

module.exports = {
    emitter,
    expireTimedRooms,
    expireInactivePublicRoomMembers,
    createRoom,
    joinRoom,
    joinRoomByCode,
    leaveRoom,
    listPublicRooms,
    listMyRooms,
    listMyConfessions,
    postConfession,
    listConfessions,
    getAudioUploadToken,
    getConfessionAudioUrl,
    postReply,
    listReplies,
    reactToTarget,
    sendChatRequestForConfession,
    reportTarget,
    getRecommendations,
    getAnalyticsSummary,
    listModerationQueue,
    resolveModerationQueueItem,
    touchMemberActivity,
    createServiceError,
    getUserActiveRooms,
    listRoomMembers,
    shuffleAlias,
    listMyScheduledConfessions,
    confirmPublishConfession,
    cancelScheduledConfession,
    publishDueScheduledConfessions
};
