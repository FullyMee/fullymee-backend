const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const conversationController = require('../controllers/conversation.controller');

router.get('/', authenticate, conversationController.getMyConversations);
router.post('/create-dm', authenticate, conversationController.createDM);
router.post('/requests', authenticate, conversationController.sendUserChatRequest);
router.get('/my', authenticate, conversationController.getMyConversations);
router.get('/unread', authenticate, conversationController.getUnread);
router.get('/requests', authenticate, conversationController.getChatRequests);
router.post('/requests/:requestId/respond', authenticate, conversationController.respondToChatRequest);

module.exports = router;
