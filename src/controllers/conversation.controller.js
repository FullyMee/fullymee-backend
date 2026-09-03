const conversationService = require("../services/conversation.service");
const messageService = require("../services/message.service");
const Conversation = require("../models/conversation.model");
const ConversationRead = require("../models/conversationRead.model");
const Message = require("../models/message.model");

exports.createDM = async (req, res) => {
    return res.status(403).json({
        error: 'Direct conversation creation is disabled. Send a chat request first.'
    });
};

exports.getUnread = async (req, res) => {
    try {
        const userId = req.user.userId;

        const counts = await conversationService.getUnreadCounts(userId);

        res.status(200).json(counts);

    } catch (err) {
        console.error("Unread Count Error:", err);

        res.status(500).json({
            error: "Failed to fetch unread counts"
        });
    }
};

exports.markRead = async (req, res) => {
    try {
        const userId = Number(req.user && req.user.userId);
        const conversationId = Number(req.params.conversationId);
        const messageId = req.body && req.body.messageId ? Number(req.body.messageId) : null;

        if (!userId || !conversationId) {
            return res.status(400).json({ error: "Invalid conversation or user ID" });
        }

        const conversation = await Conversation.findOne({
            id: conversationId,
            participants: userId,
            deletedAt: null
        }).lean();

        if (!conversation) {
            return res.status(404).json({ error: "Conversation not found or access denied" });
        }

        let targetMessageId = messageId;
        if (!targetMessageId) {
            const latest = await Message.findOne({ conversationId }).sort({ id: -1 }).select({ id: 1 }).lean();
            targetMessageId = (latest && latest.id) || 0;
        }

        if (targetMessageId > 0) {
            await ConversationRead.findOneAndUpdate(
                { conversationId, userId },
                {
                    conversationId,
                    userId,
                    lastReadMessageId: targetMessageId,
                    updatedAt: new Date()
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            await messageService.markMessagesRead(conversationId, userId, targetMessageId);
        }

        res.status(200).json({ success: true, conversationId, lastReadMessageId: targetMessageId });
    } catch (err) {
        console.error("Mark Read Error:", err);
        res.status(500).json({ error: "Failed to mark messages as read" });
    }
};

exports.getChatRequests = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const result = await conversationService.listChatRequests(userId);
        res.status(200).json(result);
    } catch (err) {
        console.error("Failed to fetch chat requests", err);
        res.status(500).json({ error: "Failed to fetch chat requests" });
    }
};

exports.respondToChatRequest = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const requestId = Number(req.params.requestId);
        const action = req.body && req.body.action;

        if (!requestId || Number.isNaN(requestId)) {
            return res.status(400).json({ error: 'Invalid requestId' });
        }
        if (action !== 'accept' && action !== 'decline') {
            return res.status(400).json({ error: 'Action must be accept or decline' });
        }

        const result = await conversationService.respondToChatRequest({
            userId,
            requestId,
            action
        });

        res.status(200).json(result);
    } catch (err) {
        if (err && Number.isFinite(err.retryAfterSec)) {
            res.set('Retry-After', String(Math.max(1, Math.floor(err.retryAfterSec))));
        }

        if (err && Number.isFinite(err.status)) {
            return res.status(err.status).json({ error: err.message || 'Failed to respond to chat request' });
        }
        console.error("Failed to respond to chat request", err);
        res.status(500).json({ error: "Failed to respond to chat request" });
    }
};

exports.sendUserChatRequest = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const targetUserId = Number(req.body && req.body.targetUserId);

        if (!targetUserId || Number.isNaN(targetUserId)) {
            return res.status(400).json({ error: 'targetUserId required' });
        }

        const result = await conversationService.createUserSearchChatRequest({
            requesterUserId: userId,
            targetUserId
        });

        res.status(200).json(result);
    } catch (err) {
        if (err && Number.isFinite(err.status)) {
            return res.status(err.status).json({
                error: err.message || 'Failed to send chat request',
                code: err.code || undefined
            });
        }
        console.error("Failed to send user chat request", err);
        res.status(500).json({ error: "Failed to send chat request" });
    }
};

function handleConnectionError(res, err, fallbackMessage) {
    if (err && Number.isFinite(err.status)) {
        return res.status(err.status).json({
            error: err.message || fallbackMessage,
            code: err.code || undefined
        });
    }
    console.error(fallbackMessage, err);
    return res.status(500).json({ error: fallbackMessage });
}

exports.getMyConversations = async (req, res) => {
    try {
        const userId = req.user.userId;
        const view = String((req.query && req.query.view) || 'active');
        const conversationId = Number((req.query && req.query.conversationId) || 0);
        const conversations = await conversationService.getUserConversations(userId, { view, conversationId });
        res.status(200).json(conversations);
    } catch (err) {
        console.error("Fetch Conversations Error:", err);
        res.status(500).json({ error: "Failed to fetch conversations" });
    }
};

exports.getConversations = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const view = String((req.query && req.query.view) || 'active');
        const conversationId = Number((req.query && req.query.conversationId) || 0);
        const conversations = await conversationService.getUserConversations(userId, { view, conversationId });
        res.status(200).json(conversations);
    } catch (err) {
        console.error("Failed to fetch conversations", err);
        res.status(500).json({ error: "Failed to fetch conversations" });
    }
};

exports.getClosingNotes = async (req, res) => {
    try {
        res.status(200).json(conversationService.getClosingNotesCatalog());
    } catch (err) {
        handleConnectionError(res, err, 'Failed to load closing notes');
    }
};

exports.getConversation = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }
        const conversation = await conversationService.getConversationById(userId, conversationId);
        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to fetch conversation');
    }
};

exports.endConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const closingNoteId = req.body && Object.prototype.hasOwnProperty.call(req.body, 'closingNoteId')
            ? req.body.closingNoteId
            : null;

        const conversation = await conversationService.endConnection({
            userId,
            conversationId,
            closingNoteId
        });

        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to end connection');
    }
};

exports.pauseConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const conversation = await conversationService.pauseConnection({ userId, conversationId });
        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to pause conversation');
    }
};

exports.resumeConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const conversation = await conversationService.resumeConnection({ userId, conversationId });
        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to resume conversation');
    }
};

exports.archiveConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const conversation = await conversationService.archiveConnectionForUser({ userId, conversationId });
        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to archive conversation');
    }
};

exports.unarchiveConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const conversation = await conversationService.unarchiveConnectionForUser({ userId, conversationId });
        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to unarchive conversation');
    }
};

exports.deleteConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const result = await conversationService.deleteConnectionForUser({ userId, conversationId });
        res.status(200).json(result);
    } catch (err) {
        handleConnectionError(res, err, 'Failed to delete conversation');
    }
};

exports.reportConnection = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const conversationId = Number(req.params.conversationId);
        if (!conversationId || Number.isNaN(conversationId)) {
            return res.status(400).json({ error: 'Invalid conversationId' });
        }

        const reason = req.body && req.body.reason ? String(req.body.reason) : '';
        const conversation = await conversationService.reportAndEndConnection({
            userId,
            conversationId,
            reason
        });

        res.status(200).json({ conversation });
    } catch (err) {
        handleConnectionError(res, err, 'Failed to report conversation');
    }
};
