const messageService = require('../services/message.service');
const { sendMessageSchema } = require('../validators/message.validator');


/* ✅ Send Message */
exports.sendMessage = async (req, res) => {
    try {

        const parsed = sendMessageSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                error: parsed.error.errors
            });
        }

        const senderId = req.user.userId;
        const { conversationId, content, clientMessageId } = parsed.data;

        const message = await messageService.createMessage(
            conversationId,
            senderId,
            content,
            clientMessageId || null
        );

        res.status(200).json(message);

    } catch (err) {
        if (err && Number.isFinite(err.retryAfterSec)) {
            res.set('Retry-After', String(Math.max(1, Math.floor(err.retryAfterSec))));
        }

        if (err && Number.isFinite(err.status)) {
            return res.status(err.status).json({
                error: err.message || 'Failed to send message'
            });
        }

        console.error("Send Message Error:", err);

        res.status(500).json({
            error: 'Failed to send message'
        });
    }
};


/* ✅ Fetch Full Conversation */
exports.getMessages = async (req, res) => {
    try {

        const userId = req.user.userId;
        const conversationId = Number(req.params.conversationId);
        const limit = Number(req.query.limit || 0);

        if (!conversationId || isNaN(conversationId)) {
            return res.status(400).json({
                error: 'Invalid conversationId'
            });
        }

        if (req.query.limit !== undefined && (!limit || isNaN(limit) || limit < 1 || limit > 100)) {
            return res.status(400).json({
                error: 'Invalid limit'
            });
        }

        const messages = await messageService.fetchMessages(conversationId, userId, limit || null);

        res.status(200).json(messages);

    } catch (err) {
        if (err && Number.isFinite(err.status)) {
            return res.status(err.status).json({
                error: err.message || 'Failed to fetch messages'
            });
        }

        console.error("Fetch Messages Error:", err);

        res.status(500).json({
            error: 'Failed to fetch messages'
        });
    }
};


/* ✅ Incremental Sync (Recovery / Reconnect Safe) */
exports.getMessagesAfter = async (req, res) => {
    try {

        const userId = req.user.userId;
        const conversationId = Number(req.params.conversationId);
        const lastMessageId = Number(req.query.after || 0);

        if (!conversationId || isNaN(conversationId)) {
            return res.status(400).json({
                error: 'Invalid conversationId'
            });
        }

        if (isNaN(lastMessageId)) {
            return res.status(400).json({
                error: 'Invalid cursor'
            });
        }

        const messages = await messageService.fetchMessagesAfter(
            conversationId,
            userId,
            lastMessageId
        );

        res.status(200).json(messages);

    } catch (err) {
        if (err && Number.isFinite(err.status)) {
            return res.status(err.status).json({
                error: err.message || 'Failed to sync messages'
            });
        }

        console.error("Sync Error:", err);

        res.status(500).json({
            error: 'Failed to sync messages'
        });
    }
};
