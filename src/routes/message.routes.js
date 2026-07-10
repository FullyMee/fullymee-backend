const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const messageController = require('../controllers/message.controller');

/* Send Message */
router.post('/send', authenticate, messageController.sendMessage);

/* Full Conversation Fetch */
router.get('/:conversationId', authenticate, messageController.getMessages);

/* ✅ Incremental Sync Endpoint */
router.get('/:conversationId/sync', authenticate, messageController.getMessagesAfter);

module.exports = router;