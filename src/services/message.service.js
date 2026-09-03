const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { getNextSequence } = require('../utils/sequence');
const { rememberClientMessageId } = require('./bloomFilter.service');

function createMessageServiceError(message, status = 400) {
    const err = new Error(message);
    err.status = status;
    return err;
}

async function getAccessibleConversation(conversationId, userId, { forWrite = false } = {}) {
    const conversation = await Conversation.findOne({
        id: Number(conversationId),
        participants: Number(userId)
    })
        .select({
            _id: 0,
            id: 1,
            status: 1,
            isArchived: 1,
            deletedAt: 1,
            participantMeta: 1,
            closingNoteText: 1,
            endedAt: 1
        })
        .lean();

    if (!conversation) {
        throw createMessageServiceError('Conversation not found', 404);
    }

    const meta = Array.isArray(conversation.participantMeta)
        ? conversation.participantMeta.find((row) => Number(row.userId) === Number(userId))
        : null;

    if (meta && meta.isDeleted) {
        const updatedMeta = (conversation.participantMeta || []).map((row) => (
            Number(row.userId) === Number(userId)
                ? { ...row, isDeleted: false, deletedAt: null, isArchived: false, archivedAt: null }
                : row
        ));
        await Conversation.updateOne(
            { id: conversation.id },
            { $set: { participantMeta: updatedMeta } }
        );
        meta.isDeleted = false;
        meta.isArchived = false;
    }

    if (conversation.deletedAt) {
        throw createMessageServiceError('Conversation is no longer available', 410);
    }

    const status = conversation.status || 'ACTIVE';

    if (forWrite) {
        if (status === 'ENDED') {
            const err = createMessageServiceError('This conversation has come to an end.', 409);
            err.code = 'CONVERSATION_CLOSED';
            throw err;
        }
        if (status === 'PAUSED') {
            const err = createMessageServiceError('This conversation is paused.', 409);
            err.code = 'CONVERSATION_PAUSED';
            throw err;
        }
    }

    return conversation;
}

exports.createMessage = async (conversationId, senderId, content, clientMessageId = null) => {
    await getAccessibleConversation(conversationId, senderId, { forWrite: true });

    // Idempotency check: if clientMessageId already exists, return the existing message
    if (clientMessageId) {
        const existing = await Message.findOne({ clientMessageId })
            .select({ _id: 0, id: 1, seq: 1, conversationId: 1, senderId: 1, content: 1, status: 1, createdAt: 1, deliveredAt: 1, readAt: 1, clientMessageId: 1 })
            .lean();
        if (existing) {
            rememberClientMessageId(clientMessageId);
            return existing;
        }
    }

    // Atomic conversation-level monotonic sequence counter
    const conv = await Conversation.findOneAndUpdate(
        { id: Number(conversationId) },
        { $inc: { lastMessageSeq: 1 } },
        { new: true }
    );
    const seq = (conv && conv.lastMessageSeq) || 1;

    const id = await getNextSequence('messages');
    const createdAt = new Date();

    try {
        await Message.create({
            id,
            seq,
            conversationId: Number(conversationId),
            senderId: Number(senderId),
            content,
            status: 'sent',
            clientMessageId: clientMessageId || null,
            createdAt
        });
    } catch (err) {
        // Race condition duplicate check: if concurrent request inserted same clientMessageId
        if (err && err.code === 11000 && clientMessageId) {
            const existing = await Message.findOne({ clientMessageId })
                .select({ _id: 0, id: 1, seq: 1, conversationId: 1, senderId: 1, content: 1, status: 1, createdAt: 1, deliveredAt: 1, readAt: 1, clientMessageId: 1 })
                .lean();
            if (existing) {
                rememberClientMessageId(clientMessageId);
                return existing;
            }
        }
        throw err;
    }

    if (clientMessageId) {
        rememberClientMessageId(clientMessageId);
    }

    return {
        id,
        seq,
        conversationId: Number(conversationId),
        senderId: Number(senderId),
        content,
        status: 'sent',
        createdAt,
        deliveredAt: null,
        readAt: null,
        clientMessageId
    };
};

exports.fetchMessages = async (conversationId, userId, options = {}) => {
    // Reads remain allowed after Silent Exit so both sides can see history + closing state
    await getAccessibleConversation(conversationId, userId, { forWrite: false });

    const limit = typeof options === 'number' ? options : (options && options.limit);
    const before = options && options.before !== undefined && options.before !== null ? Number(options.before) : null;
    const after = options && options.after !== undefined && options.after !== null ? Number(options.after) : null;

    const queryFilter = { conversationId: Number(conversationId) };
    if (before !== null && Number.isFinite(before)) {
        queryFilter.id = { $lt: before };
    } else if (after !== null && Number.isFinite(after)) {
        queryFilter.id = { $gt: after };
    }

    const query = Message.find(queryFilter)
        .select({ _id: 0, id: 1, seq: 1, senderId: 1, content: 1, status: 1, createdAt: 1, deliveredAt: 1, readAt: 1, clientMessageId: 1 });

    const normalizedLimit = Number(limit);
    const maxLimit = Number.isFinite(normalizedLimit) && normalizedLimit > 0
        ? Math.min(100, Math.floor(normalizedLimit))
        : 50;

    if (after !== null && Number.isFinite(after)) {
        const rows = await query.sort({ seq: 1, id: 1 }).limit(maxLimit).lean();
        return rows;
    }

    // Default or "before": fetch newest first, then reverse so result is chronological
    const rows = await query.sort({ seq: -1, id: -1 }).limit(maxLimit).lean();
    return rows.reverse();
};

exports.fetchMessagesAfter = async (conversationId, userId, lastMessageId) => {
    await getAccessibleConversation(conversationId, userId, { forWrite: false });

    const rows = await Message.find({
        conversationId: Number(conversationId),
        id: { $gt: Number(lastMessageId || 0) }
    })
        .sort({ seq: 1, id: 1 })
        .limit(100)
        .select({ _id: 0, id: 1, seq: 1, senderId: 1, content: 1, status: 1, createdAt: 1, deliveredAt: 1, readAt: 1, clientMessageId: 1 })
        .lean();

    return rows;
};

exports.markMessagesDelivered = async (conversationId, recipientUserId, messageIds = null) => {
    const filter = {
        conversationId: Number(conversationId),
        senderId: { $ne: Number(recipientUserId) },
        status: 'sent'
    };

    if (Array.isArray(messageIds) && messageIds.length > 0) {
        const validIds = messageIds.map(Number).filter(id => Number.isFinite(id) && id > 0);
        if (validIds.length > 0) {
            filter.id = { $in: validIds };
        }
    }

    const now = new Date();
    const toUpdate = await Message.find(filter).select({ _id: 0, id: 1, senderId: 1 }).lean();
    if (!toUpdate.length) return [];

    const ids = toUpdate.map(m => m.id);
    await Message.updateMany(
        { id: { $in: ids } },
        { $set: { status: 'delivered', deliveredAt: now } }
    );

    return toUpdate.map(m => ({ messageId: m.id, senderId: m.senderId, deliveredAt: now }));
};

exports.markMessagesRead = async (conversationId, readerUserId, upToMessageId) => {
    const maxId = Number(upToMessageId || 0);
    if (!maxId) return [];

    const filter = {
        conversationId: Number(conversationId),
        id: { $lte: maxId },
        senderId: { $ne: Number(readerUserId) },
        status: { $ne: 'read' }
    };

    const now = new Date();
    const toUpdate = await Message.find(filter).select({ _id: 0, id: 1, senderId: 1 }).lean();
    if (!toUpdate.length) return [];

    const ids = toUpdate.map(m => m.id);
    await Message.updateMany(
        { id: { $in: ids } },
        { $set: { status: 'read', readAt: now } }
    );

    return toUpdate.map(m => ({ messageId: m.id, senderId: m.senderId, readAt: now }));
};
