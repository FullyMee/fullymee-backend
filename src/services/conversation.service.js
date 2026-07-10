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

// Service-level emitter for conversation events
const emitter = new EventEmitter();

exports.emitter = emitter;

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

function sanitizeChatRequest(row, viewerUserId) {
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
        existing = await Conversation.findOne({
            type: 'dm',
            participants: { $all: [userA, userB], $size: 2 }
        }).select({ id: 1, participantDisplayNames: 1, _id: 0 }).lean();
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
        sourceType: options.sourceType === 'chat_request' ? 'chat_request' : 'direct'
    });
    rememberDMConversation(userA, userB);

    return { conversationId };
};

exports.getUserConversations = async (userId) => {
    const rows = await Conversation.find({ participants: userId })
        .sort({ id: -1 })
        .select({ _id: 0, id: 1, type: 1, participants: 1, participantDisplayNames: 1, sourceType: 1, createdAt: 1 })
        .lean();

    return rows.map((row) => ({
        id: row.id,
        type: row.type,
        participants: row.participants || [],
        participantDisplayNames: toDisplayNamesMap(row.participantDisplayNames),
        sourceType: row.sourceType || 'direct',
        created_at: row.createdAt
    }));
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
        { $match: { participants: userId } },
        { $project: { _id: 0, id: 1 } },
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
        existing = await Conversation.findOne({
            type: 'dm',
            participants: { $all: [userId, targetUserId], $size: 2 }
        }).select({ id: 1, participantDisplayNames: 1, _id: 0 }).lean();
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

    const conversationId = await getNextSequence('conversations');
    await Conversation.create({
        id: conversationId,
        type: 'dm',
        participants: [userId, targetUserId],
        participantDisplayNames: normalizedDisplayNames,
        sourceType: options.sourceType === 'chat_request' ? 'chat_request' : 'direct'
    });
    rememberDMConversation(userId, targetUserId);

    // Emit service-level event for new DM creation
    try {
        emitter.emit('dm_created', { conversationId, participants: [userId, targetUserId] });
    } catch (e) {
        // non-fatal
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

    let existingConversation = null;
    if (mightHaveDMConversation(requesterId, targetId)) {
        existingConversation = await Conversation.findOne({
            type: 'dm',
            participants: { $all: [requesterId, targetId], $size: 2 }
        }).select({ id: 1, _id: 0 }).lean();
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

    return {
        pendingIncomingCount: pendingIncomingRows.length,
        pending: pendingIncomingRows.map((row) => sanitizeChatRequest(row, uid)),
        outgoingPending: outgoingPendingRows.map((row) => sanitizeChatRequest(row, uid)),
        accepted: acceptedRows.map((row) => sanitizeChatRequest(row, uid))
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
        const result = await exports.getOrCreateDM(
            Number(request.requesterUserId),
            Number(request.targetUserId),
            {
                sourceType: 'chat_request',
                displayNames: {
                    [request.requesterUserId]: request.requesterAlias,
                    [request.targetUserId]: request.targetAlias
                }
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
