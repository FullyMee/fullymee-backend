const conversationService = require("../services/conversation.service");

exports.createDM = async (req, res) => {
    return res.status(403).json({
        error: 'Direct conversation creation is disabled. Send a chat request first.'
    });
};

exports.getMyConversations = async (req, res) => {
    try {
        const userId = req.user.userId;

        const conversations = await conversationService.getUserConversations(userId);

        res.status(200).json(conversations);

    } catch (err) {
        console.error("Fetch Conversations Error:", err);

        res.status(500).json({
            error: "Failed to fetch conversations"
        });
    }
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

exports.getConversations = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;

        const conversations = await conversationService.getUserConversations(userId);

        res.status(200).json(conversations);
    } catch (err) {
        console.error("Failed to fetch conversations", err);
        res.status(500).json({ error: "Failed to fetch conversations" });
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
            return res.status(err.status).json({ error: err.message || 'Failed to send chat request' });
        }
        console.error("Failed to send user chat request", err);
        res.status(500).json({ error: "Failed to send chat request" });
    }
};
