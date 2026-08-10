const EventEmitter = require('events');
const Conversation = require('../models/conversation.model');
const ConversationRead = require('../models/conversationRead.model');
const Message = require('../models/message.model');
const ChatRequest = require('../models/chatRequest.model');
const User = require('../models/user.model');
const { getNextSequence } = require('../utils/sequence');
const {
    mightHaveDMConversation,
    mightHaveChatRequest,
    rememberDMConversation,
    rememberChatRequest
} = require('./bloomFilter.service');
const {
    CONVERSATION_STATUS,
    END_REASONS,
    MAX_RECONNECTS,
    DEFAULT_CLOSING_NOTE_TEXT,
    CLOSING_NOTES,
    resolveClosingNote,
    getReconnectCooldownMs
} = require('../constants/closingNotes');

// Service-level emitter for conversation events
const emitter = new EventEmitter();

exports.emitter = emitter;
exports.CLOSING_NOTES = CLOSING_NOTES;
exports.DEFAULT_CLOSING_NOTE_TEXT = DEFAULT_CLOSING_NOTE_TEXT;
exports.CONVERSATION_STATUS = CONVERSATION_STATUS;

function toDisplayNamesMap(displayNames) {
    if (!displayNames || typeof displayNames !== 'object') return {};
    if (displayNames instanceof Map) {
        return toDisplayNamesMap(Object.fromEntries(displayNames.entries()));
    }
    const next = {};
    for (const [key, value] of Object.entries(displayNames)) {
        const userId = Number(key);
        const label = String(value || '').trim();
        if (!userId || !label) continue;
        next[String(userId)] = label;
    }
    return next;
}

function mergeDisplayNames(baseDisplayNames, nextDisplayNames) {
    return {
        ...toDisplayNamesMap(baseDisplayNames),
        ...toDisplayNamesMap(nextDisplayNames)
    };
}

function trimPreview(value, limit = 140) {
    const text = String(value || '').trim().replace(/\s+/g, ' ');
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1).trim()}...`;
}

function createConversationError(code, message, status = 400) {
    const err = new Error(message);
    err.code = code;
    err.status = status;
    return err;
}

function buildDefaultParticipantMeta(participants = []) {
    return (participants || []).map((userId) => ({
        userId: Number(userId),
        isArchived: false,
        isDeleted: false,
        archivedAt: null,
        deletedAt: null,
        lastSeenAt: null
    })).filter((row) => row.userId);
}

function ensureParticipantMeta(conversation, participants) {
    const existing = Array.isArray(conversation && conversation.participantMeta)
        ? conversation.participantMeta
        : [];
    const byUserId = new Map(
        existing
            .filter((row) => row && Number(row.userId))
            .map((row) => [Number(row.userId), row])
    );

    return (participants || []).map((rawUserId) => {
        const userId = Number(rawUserId);
        const current = byUserId.get(userId);
        if (current) {
            return {
                userId,
                isArchived: !!current.isArchived,
                isDeleted: !!current.isDeleted,
                archivedAt: current.archivedAt || null,
                deletedAt: current.deletedAt || null,
                lastSeenAt: current.lastSeenAt || null
            };
        }
        return {
            userId,
            isArchived: false,
            isDeleted: false,
            archivedAt: null,
            deletedAt: null,
            lastSeenAt: null
        };
    });
}

function getParticipantMetaForUser(conversation, userId) {
    const uid = Number(userId);
    const meta = ensureParticipantMeta(conversation, conversation.participants || []);
    return meta.find((row) => Number(row.userId) === uid) || {
        userId: uid,
        isArchived: false,
        isDeleted: false,
        archivedAt: null,
        deletedAt: null,
        lastSeenAt: null
    };
}

async function attachParticipantAvatars(conversations) {
    if (!conversations || !conversations.length) return conversations;
    const participantIds = [...new Set(conversations.flatMap(c => c.participants || []))];
    if (!participantIds.length) return conversations;

    const users = await User.find({ id: { $in: participantIds } }).select({ id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || '🌊']));

    for (const c of conversations) {
        if (!c.participantAvatars) {
            c.participantAvatars = {};
        }
        for (const pid of c.participants || []) {
            c.participantAvatars[pid] = avatarMap.get(pid) || '🌊';
        }
    }
    return conversations;
}

function sanitizeConversationForViewer(row, viewerUserId) {
    const viewerId = Number(viewerUserId);
    const status = row.status || CONVERSATION_STATUS.ACTIVE;
    const meta = getParticipantMetaForUser(row, viewerId);
    const isEnded = status === CONVERSATION_STATUS.ENDED;

    return {
        id: row.id,
        type: row.type,
        participants: row.participants || [],
        participantDisplayNames: toDisplayNamesMap(row.participantDisplayNames),
        participantAvatars: row.participantAvatars || {},
        sourceType: row.sourceType || 'direct',
        created_at: row.createdAt,
        status,
        pausedBy: Number(row.pausedBy || 0) || null,
        endedAt: row.endedAt || null,
        endReason: isEnded ? (row.endReason || END_REASONS.SILENT_EXIT) : null,
        closingNoteId: isEnded ? (row.closingNoteId || null) : null,
        closingNoteText: isEnded
            ? (row.closingNoteText || DEFAULT_CLOSING_NOTE_TEXT)
            : null,
        isArchivedForMe: !!meta.isArchived,
        isDeletedForMe: !!meta.isDeleted,
        reconnectCount: Number(row.reconnectCount || 0),
        reconnectAllowedAfter: row.reconnectAllowedAfter || null,
        reconnectBlocked: !!row.reconnectBlocked,
        canReconnect: canRequestReconnect(row)
        // endedBy intentionally omitted — never exposed to clients
    };
}

function canRequestReconnect(conversation) {
    if (!conversation) return false;
    if (conversation.status !== CONVERSATION_STATUS.ENDED) return false;
    if (conversation.reconnectBlocked) return false;
    if (conversation.endReason === END_REASONS.REPORT) return false;

    const reconnectCount = Number(conversation.reconnectCount || 0);
    const maxReconnects = Number.isFinite(MAX_RECONNECTS) && MAX_RECONNECTS >= 0
        ? MAX_RECONNECTS
        : 1;
    if (reconnectCount >= maxReconnects) return false;

    const allowedAfter = conversation.reconnectAllowedAfter
        ? new Date(conversation.reconnectAllowedAfter).getTime()
        : 0;
    if (allowedAfter && Date.now() < allowedAfter) return false;

    return true;
}

async function findActiveDmBetween(userA, userB) {
    const conv = await Conversation.findOne({
        type: 'dm',
        participants: { $all: [userA, userB], $size: 2 },
        status: CONVERSATION_STATUS.ACTIVE
    })
        .select({ id: 1, participantDisplayNames: 1, status: 1, participantMeta: 1, _id: 0 })
        .lean();

    if (!conv) return null;

    const uidA = Number(userA);
    const uidB = Number(userB);
    const metaA = (conv.participantMeta || []).find(m => Number(m.userId) === uidA);
    const metaB = (conv.participantMeta || []).find(m => Number(m.userId) === uidB);

    if (metaA?.isDeleted || metaB?.isDeleted) {
        const updatedMeta = (conv.participantMeta || []).map((row) => {
            if (row.isDeleted) {
                return { ...row, isDeleted: false, deletedAt: null, isArchived: false, archivedAt: null };
            }
            return row;
        });
        await Conversation.updateOne(
            { id: conv.id },
            { $set: { participantMeta: updatedMeta } }
        );
    }

    return conv;
}

async function findLatestEndedDmBetween(userA, userB) {
    return Conversation.findOne({
        type: 'dm',
        participants: { $all: [userA, userB], $size: 2 },
        status: CONVERSATION_STATUS.ENDED
    })
        .sort({ endedAt: -1, id: -1 })
        .select({
            _id: 0,
            id: 1,
            status: 1,
            endedAt: 1,
            endReason: 1,
            reconnectCount: 1,
            reconnectAllowedAfter: 1,
            reconnectBlocked: 1
        })
        .lean();
}

async function requireParticipantConversation(conversationId, userId, { includeEndedBy = false } = {}) {
    const cid = Number(conversationId);
    const uid = Number(userId);
    if (!cid || !uid) {
        throw createConversationError('CONVERSATION_INVALID', 'Invalid conversation.', 400);
    }

    const select = {
        _id: 0,
        id: 1,
        type: 1,
        participants: 1,
        participantDisplayNames: 1,
        participantMeta: 1,
        sourceType: 1,
        createdAt: 1,
        status: 1,
        pausedBy: 1,
        endedAt: 1,
        endReason: 1,
        closingNoteId: 1,
        closingNoteText: 1,
        reconnectCount: 1,
        reconnectAllowedAfter: 1,
        reconnectBlocked: 1,
        isArchived: 1,
        deletedAt: 1
    };
    if (includeEndedBy) {
        select.endedBy = 1;
    }

    const conversation = await Conversation.findOne({
        id: cid,
        participants: uid
    })
        .select(select)
        .lean();

    if (!conversation) {
        throw createConversationError('CONVERSATION_NOT_FOUND', 'Conversation not found.', 404);
    }

    const meta = getParticipantMetaForUser(conversation, uid);
    if (meta.isDeleted) {
        // Auto-restore conversation when user accesses/messages again from profile or search
        const updatedMeta = (conversation.participantMeta || []).map((row) => (
            Number(row.userId) === uid
                ? { ...row, isDeleted: false, deletedAt: null, isArchived: false, archivedAt: null }
                : row
        ));
        await Conversation.updateOne(
            { id: conversation.id },
            { $set: { participantMeta: updatedMeta } }
        );
        conversation.participantMeta = updatedMeta;
    }

    return conversation;
}

function emitConversationLifecycle(eventName, payload) {
    try {
        emitter.emit(eventName, payload);
    } catch (err) {
        console.error(`Emitter error (${eventName}):`, err);
    }
}

function sanitizeChatRequest(row, viewerUserId, avatar = null) {
    const viewerId = Number(viewerUserId);
    const isIncoming = Number(row.targetUserId) === viewerId;
    const displayAlias = isIncoming ? row.requesterAlias : row.targetAlias;

    return {
        requestId: row.id,
        status: row.status,
        roomId: row.roomId,
        confessionId: row.confessionId,
        conversationId: row.conversationId || null,
        contextType: row.contextType || 'confession',
        contextPreview: row.contextPreview || '',
        displayAlias,
        displayAvatar: avatar || null,
        requesterAlias: row.requesterAlias,
        targetAlias: row.targetAlias,
        createdAt: row.createdAt,
        respondedAt: row.respondedAt || null,
        isIncoming,
        canAccept: isIncoming && row.status === 'pending',
        canDecline: isIncoming && row.status === 'pending'
    };
}

exports.createDMConversation = async (userA, userB, options = {}) => {

    if (userA === userB)
        throw new Error("Cannot create conversation with yourself");

    let existing = null;
    if (mightHaveDMConversation(userA, userB)) {
        existing = await findActiveDmBetween(userA, userB);
    }

    const normalizedDisplayNames = toDisplayNamesMap(options.displayNames);
    if (existing) {
        if (Object.keys(normalizedDisplayNames).length > 0) {
            await Conversation.updateOne(
                { id: existing.id },
                {
                    $set: {
                        participantDisplayNames: mergeDisplayNames(existing.participantDisplayNames, normalizedDisplayNames)
                    }
                }
            );
        }
        rememberDMConversation(userA, userB);
        return { conversationId: existing.id };
    }

    const conversationId = await getNextSequence('conversations');
    await Conversation.create({
        id: conversationId,
        type: 'dm',
        participants: [userA, userB],
        participantDisplayNames: normalizedDisplayNames,
        participantMeta: buildDefaultParticipantMeta([userA, userB]),
        sourceType: options.sourceType === 'chat_request' ? 'chat_request' : 'direct',
        status: CONVERSATION_STATUS.ACTIVE
    });
    rememberDMConversation(userA, userB);

    return { conversationId };
};

exports.getUserConversations = async (userId, options = {}) => {
    const uid = Number(userId);
    const view = String(options.view || 'active').toLowerCase();
    const targetConversationId = Number(options.conversationId || 0);

    const rows = await Conversation.find({ participants: uid })
        .sort({ id: -1 })
        .select({
            _id: 0,
            id: 1,
            type: 1,
            participants: 1,
            participantDisplayNames: 1,
            participantMeta: 1,
            sourceType: 1,
            createdAt: 1,
            status: 1,
            pausedBy: 1,
            endedAt: 1,
            endReason: 1,
            closingNoteId: 1,
            closingNoteText: 1,
            reconnectCount: 1,
            reconnectAllowedAfter: 1,
            reconnectBlocked: 1
        })
        .lean();

    // Auto-restore target conversation if deleted when user explicitly requests/accesses it
    if (targetConversationId) {
        for (const row of rows) {
            if (Number(row.id) === targetConversationId) {
                const meta = (row.participantMeta || []).find(m => Number(m.userId) === uid);
                if (meta && meta.isDeleted) {
                    const updatedMeta = (row.participantMeta || []).map((m) => (
                        Number(m.userId) === uid
                            ? { ...m, isDeleted: false, deletedAt: null, isArchived: false, archivedAt: null }
                            : m
                    ));
                    await Conversation.updateOne(
                        { id: row.id },
                        { $set: { participantMeta: updatedMeta } }
                    );
                    row.participantMeta = updatedMeta;
                }
            }
        }
    }

    await attachParticipantAvatars(rows);

    const sanitized = rows
        .map((row) => sanitizeConversationForViewer(row, uid))
        .filter((row) => !row.isDeletedForMe);

    const allParticipantIds = [...new Set(sanitized.flatMap(c => c.participants))].filter(Boolean);
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: allParticipantIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    for (const conv of sanitized) {
        conv.participantAvatars = {};
        for (const pId of conv.participants) {
            if (avatarMap.has(pId)) {
                conv.participantAvatars[String(pId)] = avatarMap.get(pId);
            }
        }
    }

    if (view === 'all') {
        return sanitized;
    }

    if (view === 'archived') {
        return sanitized.filter((row) => row.isArchivedForMe);
    }

    if (view === 'past') {
        return sanitized.filter((row) => row.status === CONVERSATION_STATUS.ENDED && !row.isArchivedForMe);
    }

    // Active inbox: active conversations not archived or deleted by viewer
    return sanitized.filter((row) => !row.isArchivedForMe && row.status !== CONVERSATION_STATUS.ENDED);
};

exports.getReadState = async (conversationId) => {
    const rows = await ConversationRead.find({ conversationId })
        .select({ _id: 0, userId: 1, lastReadMessageId: 1 })
        .lean();

    return rows.map((row) => ({
        user_id: row.userId,
        last_read_message_id: row.lastReadMessageId
    }));
};

exports.getUnreadCounts = async (userId) => {
    const now = new Date();
    const rows = await Conversation.aggregate([
        {
            $match: {
                participants: userId,
                status: CONVERSATION_STATUS.ACTIVE
            }
        },
        { $project: { _id: 0, id: 1, participantMeta: 1 } },
        {
            $addFields: {
                viewerMeta: {
                    $first: {
                        $filter: {
                            input: { $ifNull: ['$participantMeta', []] },
                            as: 'meta',
                            cond: { $eq: ['$$meta.userId', userId] }
                        }
                    }
                }
            }
        },
        {
            $match: {
                $or: [
                    { viewerMeta: { $eq: null } },
                    {
                        'viewerMeta.isArchived': { $ne: true },
                        'viewerMeta.isDeleted': { $ne: true }
                    }
                ]
            }
        },
        {
            $lookup: {
                from: ConversationRead.collection.name,
                let: { conversationId: '$id' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$conversationId', '$$conversationId'] },
                                    { $eq: ['$userId', userId] }
                                ]
                            }
                        }
                    },
                    { $project: { _id: 0, lastReadMessageId: 1 } }
                ],
                as: 'readState'
            }
        },
        {
            $addFields: {
                lastReadMessageId: {
                    $ifNull: [{ $arrayElemAt: ['$readState.lastReadMessageId', 0] }, 0]
                }
            }
        },
        {
            $lookup: {
                from: Message.collection.name,
                let: { conversationId: '$id', lastRead: '$lastReadMessageId' },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$conversationId', '$$conversationId'] },
                                    { $gt: ['$id', '$$lastRead'] },
                                    { $gt: ['$expiresAt', now] }
                                ]
                            }
                        }
                    },
                    { $count: 'count' }
                ],
                as: 'unreadDocs'
            }
        },
        {
            $project: {
                _id: 0,
                conversationId: '$id',
                unreadCount: { $ifNull: [{ $arrayElemAt: ['$unreadDocs.count', 0] }, 0] }
            }
        }
    ]);

    return rows;
};

exports.getOrCreateDM = async (userId, targetUserId, options = {}) => {
    let existing = null;
    if (mightHaveDMConversation(userId, targetUserId)) {
        existing = await findActiveDmBetween(userId, targetUserId);
    }

    const normalizedDisplayNames = toDisplayNamesMap(options.displayNames);
    if (existing) {
        if (Object.keys(normalizedDisplayNames).length > 0) {
            await Conversation.updateOne(
                { id: existing.id },
                {
                    $set: {
                        participantDisplayNames: mergeDisplayNames(existing.participantDisplayNames, normalizedDisplayNames)
                    }
                }
            );
        }
        rememberDMConversation(userId, targetUserId);
        return { conversationId: existing.id, created: false };
    }

    // Reconnect path: only create a fresh conversation when Silent Exit rules allow it
    if (options.fromReconnect) {
        const ended = await findLatestEndedDmBetween(userId, targetUserId);
        if (ended && !canRequestReconnect(ended)) {
            throw createConversationError(
                'CONNECTION_RECONNECT_DENIED',
                'A new connection cannot be requested for this conversation yet.',
                409
            );
        }
    }

    const conversationId = await getNextSequence('conversations');
    await Conversation.create({
        id: conversationId,
        type: 'dm',
        participants: [userId, targetUserId],
        participantDisplayNames: normalizedDisplayNames,
        participantMeta: buildDefaultParticipantMeta([userId, targetUserId]),
        sourceType: options.sourceType === 'chat_request' ? 'chat_request' : 'direct',
        status: CONVERSATION_STATUS.ACTIVE,
        reconnectCount: options.fromReconnect
            ? Number((options.priorReconnectCount || 0)) + 1
            : 0
    });

    if (options.fromReconnect && options.priorConversationId) {
        await Conversation.updateOne(
            { id: Number(options.priorConversationId) },
            {
                $inc: { reconnectCount: 1 },
                $set: { reconnectAllowedAfter: null }
            }
        );
    }

    rememberDMConversation(userId, targetUserId);

    try {
        emitter.emit('dm_created', { conversationId, participants: [userId, targetUserId] });
    } catch (e) {
        console.error('Emitter error (dm_created):', e);
    }

    return { conversationId, created: true };
};

exports.createChatRequest = async ({
    requesterUserId,
    targetUserId,
    requesterAlias,
    targetAlias,
    roomId,
    confessionId,
    contextType = 'confession',
    contextPreview = ''
}) => {
    const requesterId = Number(requesterUserId);
    const targetId = Number(targetUserId);
    const normalizedContextType = contextType === 'profile' ? 'profile' : (contextType === 'reply' ? 'reply' : 'confession');
    if (!requesterId || !targetId) {
        throw createConversationError('CHAT_REQUEST_INVALID_USERS', 'Unable to create this chat request.', 400);
    }
    if (requesterId === targetId) {
        throw createConversationError('CHAT_REQUEST_TO_SELF', 'You cannot send a chat request to yourself.', 409);
    }

    // Verify target user's chat request permissions ('rooms' or 'nobody')
    const targetUserDoc = await User.findOne({ id: targetId }).select('preferences').lean();
    const targetPermission = (targetUserDoc && targetUserDoc.preferences && targetUserDoc.preferences.chatRequestPermission) === 'nobody' ? 'nobody' : 'rooms';

    if (targetPermission === 'nobody') {
        throw createConversationError(
            'CHAT_REQUESTS_DISABLED',
            'This user has turned off chat requests.',
            403
        );
    }

    if (targetPermission === 'rooms') {
        const ConfessionRoomMember = require('../models/confessionRoomMember.model');

        // If a specific roomId was provided with the request, check if target and requester are active in that room
        if (roomId) {
            const numRoomId = Number(roomId);
            if (numRoomId) {
                const targetInSpecificRoom = await ConfessionRoomMember.findOne({
                    userId: targetId,
                    roomId: numRoomId,
                    isActive: true
                }).select('_id').lean();

                if (!targetInSpecificRoom) {
                    throw createConversationError(
                        'CHAT_REQUEST_TARGET_LEFT_ROOM',
                        'This user is no longer active in this room or has left the room.',
                        403
                    );
                }

                const requesterInSpecificRoom = await ConfessionRoomMember.findOne({
                    userId: requesterId,
                    roomId: numRoomId,
                    isActive: true
                }).select('_id').lean();

                if (!requesterInSpecificRoom) {
                    throw createConversationError(
                        'CHAT_REQUEST_REQUESTER_NOT_IN_ROOM',
                        'You must be an active member of this room to send a chat request.',
                        403
                    );
                }
            }
        }

        // Check overall active room overlap between target and requester
        const targetRooms = await ConfessionRoomMember.find({ userId: targetId, isActive: true }).select('roomId').lean();
        if (!targetRooms || targetRooms.length === 0) {
            throw createConversationError(
                'CHAT_REQUEST_TARGET_NOT_IN_ROOM',
                'This user is not currently active in any room. They only accept chat requests from active room members.',
                403
            );
        }

        const targetRoomIds = new Set(targetRooms.map((r) => Number(r.roomId)));
        const requesterRooms = await ConfessionRoomMember.find({ userId: requesterId, isActive: true }).select('roomId').lean();
        const hasCommonRoom = (requesterRooms || []).some((r) => targetRoomIds.has(Number(r.roomId)));

        if (!hasCommonRoom) {
            throw createConversationError(
                'CHAT_REQUEST_NO_SHARED_ROOM',
                'This user only accepts chat requests from members currently in the same active room.',
                403
            );
        }
    }

    let existingConversation = null;
    if (mightHaveDMConversation(requesterId, targetId)) {
        existingConversation = await findActiveDmBetween(requesterId, targetId);
    }

    if (existingConversation) {
        rememberDMConversation(requesterId, targetId);
        return {
            requestId: null,
            requestState: 'already_connected',
            status: 'accepted',
            conversationId: existingConversation.id,
            targetAlias: String(targetAlias || '').trim() || 'this user'
        };
    }

    // Silent Exit reconnect: only allow a new request when cooldown + max reconnects pass
    const endedConversation = await findLatestEndedDmBetween(requesterId, targetId);
    if (endedConversation && !canRequestReconnect(endedConversation)) {
        throw createConversationError(
            'CONNECTION_RECONNECT_DENIED',
            endedConversation.endReason === END_REASONS.REPORT
                ? 'This connection cannot be restarted.'
                : 'You can request a new connection after the cooldown period.',
            409
        );
    }

    let existingRequest = null;
    const requestKey = {
        requesterUserId: requesterId,
        targetUserId: targetId,
        confessionId: Number(confessionId) || null,
        contextType: normalizedContextType
    };
    if (mightHaveChatRequest(requestKey)) {
        existingRequest = await ChatRequest.findOne({
            requesterUserId: requesterId,
            targetUserId: targetId,
            confessionId: Number(confessionId) || null,
            contextType: normalizedContextType,
            status: { $in: ['pending', 'accepted'] }
        })
            .sort({ createdAt: -1 })
            .select({ _id: 0 })
            .lean();
    }

    if (existingRequest) {
        rememberChatRequest(requestKey);
        return {
            requestId: existingRequest.id,
            requestState: existingRequest.status === 'pending' ? 'already_pending' : 'already_connected',
            status: existingRequest.status,
            conversationId: existingRequest.conversationId || null,
            targetAlias: existingRequest.targetAlias
        };
    }

    const requestId = await getNextSequence('chat_requests');
    const now = new Date();
    await ChatRequest.create({
        id: requestId,
        requesterUserId: requesterId,
        targetUserId: targetId,
        requesterAlias: String(requesterAlias || '').trim(),
        targetAlias: String(targetAlias || '').trim(),
        roomId: Number(roomId) || null,
        confessionId: Number(confessionId) || null,
        contextType: normalizedContextType,
        contextPreview: trimPreview(contextPreview, 180),
        status: 'pending',
        createdAt: now,
        updatedAt: now
    });
    rememberChatRequest(requestKey);

    try {
        emitter.emit('chat_request_created', {
            requestId,
            requesterUserId: requesterId,
            targetUserId: targetId
        });
    } catch (e) {
        console.error('Emitter error (chat_request_created):', e);
    }

    return {
        requestId,
        requestState: 'sent',
        status: 'pending',
        conversationId: null,
        targetAlias: String(targetAlias || '').trim() || 'this user'
    };
};

exports.createUserSearchChatRequest = async ({ requesterUserId, targetUserId }) => {
    const requesterId = Number(requesterUserId);
    const targetId = Number(targetUserId);

    if (!requesterId || !targetId) {
        throw createConversationError('CHAT_REQUEST_INVALID_USERS', 'Unable to create this chat request.', 400);
    }
    if (requesterId === targetId) {
        throw createConversationError('CHAT_REQUEST_TO_SELF', 'You cannot send a chat request to yourself.', 409);
    }

    const [requesterUser, targetUser] = await Promise.all([
        User.findOne({ id: requesterId }).select({ _id: 0, username: 1 }).lean(),
        User.findOne({ id: targetId }).select({ _id: 0, username: 1 }).lean()
    ]);

    if (!requesterUser || !String(requesterUser.username || '').trim()) {
        throw createConversationError('CHAT_REQUEST_REQUESTER_NOT_FOUND', 'Unable to identify the requesting user.', 404);
    }
    if (!targetUser || !String(targetUser.username || '').trim()) {
        throw createConversationError('CHAT_REQUEST_TARGET_NOT_FOUND', 'The user you want to contact could not be found.', 404);
    }

    return exports.createChatRequest({
        requesterUserId: requesterId,
        targetUserId: targetId,
        requesterAlias: String(requesterUser.username).trim(),
        targetAlias: String(targetUser.username).trim(),
        roomId: null,
        confessionId: null,
        contextType: 'profile',
        contextPreview: ''
    });
};

exports.listChatRequests = async (userId) => {
    const uid = Number(userId);
    const [pendingIncomingRows, outgoingPendingRows, acceptedRows] = await Promise.all([
        ChatRequest.find({
            targetUserId: uid,
            status: 'pending'
        })
            .sort({ createdAt: -1 })
            .select({ _id: 0 })
            .lean(),
        ChatRequest.find({
            requesterUserId: uid,
            status: 'pending'
        })
            .sort({ createdAt: -1 })
            .select({ _id: 0 })
            .lean(),
        ChatRequest.find({
            status: 'accepted',
            $or: [{ requesterUserId: uid }, { targetUserId: uid }]
        })
            .sort({ respondedAt: -1, createdAt: -1 })
            .select({ _id: 0 })
            .lean()
    ]);

    const userIds = [
        ...pendingIncomingRows.map(r => r.requesterUserId),
        ...outgoingPendingRows.map(r => r.targetUserId),
        ...acceptedRows.map(r => r.requesterUserId === uid ? r.targetUserId : r.requesterUserId)
    ];
    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: uniqueUserIds } }).select({ _id: 0, id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    return {
        pendingIncomingCount: pendingIncomingRows.length,
        pending: pendingIncomingRows.map((row) => sanitizeChatRequest(row, uid, avatarMap.get(row.requesterUserId))),
        outgoingPending: outgoingPendingRows.map((row) => sanitizeChatRequest(row, uid, avatarMap.get(row.targetUserId))),
        accepted: acceptedRows.map((row) => sanitizeChatRequest(row, uid, avatarMap.get(row.requesterUserId === uid ? row.targetUserId : row.requesterUserId)))
    };
};

exports.respondToChatRequest = async ({ userId, requestId, action }) => {
    const uid = Number(userId);
    const rid = Number(requestId);
    const normalizedAction = action === 'decline' ? 'decline' : 'accept';

    const request = await ChatRequest.findOne({ id: rid })
        .select({ _id: 0 })
        .lean();

    if (!request) {
        throw createConversationError('CHAT_REQUEST_NOT_FOUND', 'Chat request not found.', 404);
    }
    if (Number(request.targetUserId) !== uid) {
        throw createConversationError('CHAT_REQUEST_FORBIDDEN', 'You cannot respond to this chat request.', 403);
    }
    if (request.status !== 'pending') {
        throw createConversationError('CHAT_REQUEST_ALREADY_RESOLVED', 'This chat request has already been handled.', 409);
    }

    const now = new Date();
    let conversationId = null;

    if (normalizedAction === 'accept') {
        const endedConversation = await findLatestEndedDmBetween(
            Number(request.requesterUserId),
            Number(request.targetUserId)
        );
        const isReconnect = Boolean(endedConversation);
        if (isReconnect && !canRequestReconnect(endedConversation)) {
            throw createConversationError(
                'CONNECTION_RECONNECT_DENIED',
                'A new connection cannot be started for this conversation.',
                409
            );
        }

        const result = await exports.getOrCreateDM(
            Number(request.requesterUserId),
            Number(request.targetUserId),
            {
                sourceType: 'chat_request',
                displayNames: {
                    [request.requesterUserId]: request.requesterAlias,
                    [request.targetUserId]: request.targetAlias
                },
                fromReconnect: isReconnect,
                priorConversationId: isReconnect ? endedConversation.id : null,
                priorReconnectCount: isReconnect ? Number(endedConversation.reconnectCount || 0) : 0
            }
        );
        conversationId = Number(result && result.conversationId) || null;
    }

    const nextStatus = normalizedAction === 'accept' ? 'accepted' : 'declined';
    await ChatRequest.updateOne(
        { id: rid, status: 'pending' },
        {
            $set: {
                status: nextStatus,
                conversationId,
                respondedAt: now,
                updatedAt: now
            }
        }
    );

    const updated = await ChatRequest.findOne({ id: rid })
        .select({ _id: 0 })
        .lean();

    try {
        emitter.emit('chat_request_updated', {
            requestId: rid,
            requesterUserId: Number(request.requesterUserId),
            targetUserId: Number(request.targetUserId),
            status: nextStatus,
            conversationId
        });
    } catch (e) {
        console.error('Emitter error (chat_request_updated):', e);
    }

    return sanitizeChatRequest(updated, uid);
};

exports.getConversationById = async (userId, conversationId) => {
    const conversation = await requireParticipantConversation(conversationId, userId);
    await attachParticipantAvatars([conversation]);
    return sanitizeConversationForViewer(conversation, userId);
};

exports.getClosingNotesCatalog = () => ({
    notes: CLOSING_NOTES.map((note) => ({ ...note })),
    defaultText: DEFAULT_CLOSING_NOTE_TEXT
});

/**
 * Silent Exit — end a connection without revealing who initiated it.
 * endedBy is persisted for moderation only and never returned to clients.
 */
exports.endConnection = async ({ userId, conversationId, closingNoteId = null, endReason = END_REASONS.SILENT_EXIT }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);

    if (conversation.status === CONVERSATION_STATUS.ENDED) {
        return sanitizeConversationForViewer(conversation, uid);
    }

    const reason = endReason === END_REASONS.REPORT
        ? END_REASONS.REPORT
        : END_REASONS.SILENT_EXIT;

    const note = reason === END_REASONS.REPORT
        ? {
            closingNoteId: null,
            closingNoteText: DEFAULT_CLOSING_NOTE_TEXT,
            closingNoteEmoji: null
        }
        : resolveClosingNote(closingNoteId);

    const now = new Date();
    const reconnectBlocked = reason === END_REASONS.REPORT;
    const reconnectAllowedAfter = reconnectBlocked
        ? null
        : new Date(now.getTime() + getReconnectCooldownMs());

    const participantMeta = ensureParticipantMeta(conversation, conversation.participants);

    await Conversation.updateOne(
        { id: conversation.id, status: { $ne: CONVERSATION_STATUS.ENDED } },
        {
            $set: {
                status: CONVERSATION_STATUS.ENDED,
                endedAt: now,
                endedBy: uid,
                endReason: reason,
                closingNoteId: note.closingNoteId,
                closingNoteText: note.closingNoteText,
                reconnectAllowedAfter,
                reconnectBlocked,
                participantMeta,
                // Keep legacy send guards in sync
                isArchived: true
            }
        }
    );

    const updated = await Conversation.findOne({ id: conversation.id })
        .select({
            _id: 0,
            id: 1,
            type: 1,
            participants: 1,
            participantDisplayNames: 1,
            participantMeta: 1,
            sourceType: 1,
            createdAt: 1,
            status: 1,
            endedAt: 1,
            endReason: 1,
            closingNoteId: 1,
            closingNoteText: 1,
            reconnectCount: 1,
            reconnectAllowedAfter: 1,
            reconnectBlocked: 1
        })
        .lean();

    const publicPayload = {
        conversationId: updated.id,
        status: CONVERSATION_STATUS.ENDED,
        endedAt: updated.endedAt,
        endReason: updated.endReason,
        closingNoteId: updated.closingNoteId,
        closingNoteText: updated.closingNoteText || DEFAULT_CLOSING_NOTE_TEXT,
        participants: updated.participants || []
        // No endedBy — anonymity guarantee
    };

    emitConversationLifecycle('conversation_ended', publicPayload);

    return sanitizeConversationForViewer(updated, uid);
};

exports.pauseConnection = async ({ userId, conversationId }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);

    if (conversation.status === CONVERSATION_STATUS.ENDED) {
        throw createConversationError(
            'CONNECTION_ALREADY_ENDED',
            'This conversation has already ended.',
            409
        );
    }

    if (conversation.status === CONVERSATION_STATUS.PAUSED) {
        return sanitizeConversationForViewer(conversation, uid);
    }

    await Conversation.updateOne(
        { id: conversation.id },
        { $set: { status: CONVERSATION_STATUS.PAUSED, pausedBy: uid } }
    );

    const updated = await requireParticipantConversation(conversation.id, uid);
    emitConversationLifecycle('conversation_paused', {
        conversationId: updated.id,
        status: CONVERSATION_STATUS.PAUSED,
        pausedBy: uid,
        participants: updated.participants || []
    });

    return sanitizeConversationForViewer(updated, uid);
};

exports.resumeConnection = async ({ userId, conversationId }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);

    if (conversation.status === CONVERSATION_STATUS.ENDED) {
        throw createConversationError(
            'CONNECTION_ALREADY_ENDED',
            'This conversation has already ended.',
            409
        );
    }

    if (conversation.status === CONVERSATION_STATUS.ACTIVE) {
        return sanitizeConversationForViewer(conversation, uid);
    }

    if (conversation.pausedBy && Number(conversation.pausedBy) !== uid) {
        throw createConversationError(
            'PAUSE_PERMISSION_DENIED',
            'Only the person who paused this conversation can resume it.',
            403
        );
    }

    await Conversation.updateOne(
        { id: conversation.id, status: CONVERSATION_STATUS.PAUSED },
        { $set: { status: CONVERSATION_STATUS.ACTIVE, pausedBy: null } }
    );

    const updated = await requireParticipantConversation(conversation.id, uid);
    emitConversationLifecycle('conversation_resumed', {
        conversationId: updated.id,
        status: CONVERSATION_STATUS.ACTIVE,
        participants: updated.participants || []
    });

    return sanitizeConversationForViewer(updated, uid);
};

exports.archiveConnectionForUser = async ({ userId, conversationId }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);
    const now = new Date();
    const participantMeta = ensureParticipantMeta(conversation, conversation.participants)
        .map((row) => (
            Number(row.userId) === uid
                ? { ...row, isArchived: true, archivedAt: now }
                : row
        ));

    await Conversation.updateOne(
        { id: conversation.id },
        { $set: { participantMeta } }
    );

    const updated = await requireParticipantConversation(conversation.id, uid);
    return sanitizeConversationForViewer(updated, uid);
};

exports.unarchiveConnectionForUser = async ({ userId, conversationId }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);
    const participantMeta = ensureParticipantMeta(conversation, conversation.participants)
        .map((row) => (
            Number(row.userId) === uid
                ? { ...row, isArchived: false, archivedAt: null }
                : row
        ));

    await Conversation.updateOne(
        { id: conversation.id },
        { $set: { participantMeta } }
    );

    const updated = await requireParticipantConversation(conversation.id, uid);
    return sanitizeConversationForViewer(updated, uid);
};

exports.deleteConnectionForUser = async ({ userId, conversationId }) => {
    const uid = Number(userId);
    const conversation = await requireParticipantConversation(conversationId, uid);
    const now = new Date();
    const participantMeta = ensureParticipantMeta(conversation, conversation.participants)
        .map((row) => (
            Number(row.userId) === uid
                ? { ...row, isDeleted: true, deletedAt: now, isArchived: true, archivedAt: row.archivedAt || now }
                : row
        ));

    await Conversation.updateOne(
        { id: conversation.id },
        { $set: { participantMeta } }
    );

    emitConversationLifecycle('conversation_deleted_for_user', {
        conversationId: conversation.id,
        userId: uid
    });

    return { conversationId: conversation.id, deleted: true };
};

/**
 * Report → immediately Silent Exit with reconnect permanently blocked.
 */
exports.reportAndEndConnection = async ({ userId, conversationId, reason = '' }) => {
    const uid = Number(userId);
    await requireParticipantConversation(conversationId, uid);

    const result = await exports.endConnection({
        userId: uid,
        conversationId,
        closingNoteId: null,
        endReason: END_REASONS.REPORT
    });

    emitConversationLifecycle('conversation_reported', {
        conversationId: Number(conversationId),
        reporterUserId: uid,
        reason: String(reason || '').trim().slice(0, 500),
        participants: result.participants || []
    });

    return result;
};

/**
 * Shared guard used by REST + socket message paths.
 */
exports.assertConversationAcceptsMessages = (conversation) => {
    if (!conversation) {
        throw createConversationError('CONVERSATION_NOT_FOUND', 'Conversation not found.', 404);
    }

    const status = conversation.status || CONVERSATION_STATUS.ACTIVE;

    if (status === CONVERSATION_STATUS.ENDED) {
        throw createConversationError(
            'CONVERSATION_CLOSED',
            'This conversation has come to an end.',
            409
        );
    }

    if (status === CONVERSATION_STATUS.PAUSED) {
        throw createConversationError(
            'CONVERSATION_PAUSED',
            'This conversation is paused.',
            409
        );
    }

    if (conversation.deletedAt) {
        throw createConversationError(
            'CONVERSATION_DELETED',
            'Conversation is no longer available.',
            410
        );
    }

    return true;
};

