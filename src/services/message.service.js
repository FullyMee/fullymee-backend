const Message = require('../models/message.model');
const Conversation = require('../models/conversation.model');
const { getNextSequence } = require('../utils/sequence');
const { getMessageExpiresAt } = require('../utils/messageExpiry');
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
        throw createMessageServiceError('Conversation is no longer available', 410);
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

    const expiresAt = getMessageExpiresAt();
    const id = await getNextSequence('messages');
    await Message.create({
        id,
        conversationId,
        senderId,
        content,
        expiresAt,
        clientMessageId: clientMessageId || null
    });

    if (clientMessageId) {
        rememberClientMessageId(clientMessageId);
    }

    return {
        id,
        conversationId,
        senderId,
        content,
        expiresAt,
        clientMessageId
    };
};

exports.fetchMessages = async (conversationId, userId, limit = null) => {
    // Reads remain allowed after Silent Exit so both sides can see history + closing state
    await getAccessibleConversation(conversationId, userId, { forWrite: false });

    const query = Message.find({
        conversationId,
        expiresAt: { $gt: new Date() }
    })
        .select({ _id: 0, id: 1, senderId: 1, content: 1, createdAt: 1, expiresAt: 1, clientMessageId: 1 });

    const normalizedLimit = Number(limit);
    if (Number.isFinite(normalizedLimit) && normalizedLimit > 0) {
        const rows = await query
            .sort({ id: -1 })
            .limit(Math.min(100, Math.floor(normalizedLimit)))
            .lean();
        return rows.reverse();
    }

    const rows = await query
        .sort({ id: 1 })
        .lean();

    return rows;
};

exports.fetchMessagesAfter = async (conversationId, userId, lastMessageId) => {
    await getAccessibleConversation(conversationId, userId, { forWrite: false });

    const rows = await Message.find({
        conversationId,
        id: { $gt: lastMessageId },
        expiresAt: { $gt: new Date() }
    })
        .sort({ id: 1 })
        .limit(100)
        .select({ _id: 0, id: 1, senderId: 1, content: 1, createdAt: 1, expiresAt: 1, clientMessageId: 1 })
        .lean();

    return rows;
};
