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

/* Silent Exit / Manage Connection */
router.get('/closing-notes', authenticate, conversationController.getClosingNotes);
router.get('/:conversationId', authenticate, conversationController.getConversation);
router.post('/:conversationId/read', authenticate, conversationController.markRead);
router.post('/:conversationId/end', authenticate, conversationController.endConnection);
router.post('/:conversationId/pause', authenticate, conversationController.pauseConnection);
router.post('/:conversationId/resume', authenticate, conversationController.resumeConnection);
router.post('/:conversationId/archive', authenticate, conversationController.archiveConnection);
router.post('/:conversationId/unarchive', authenticate, conversationController.unarchiveConnection);
router.post('/:conversationId/report', authenticate, conversationController.reportConnection);
router.delete('/:conversationId', authenticate, conversationController.deleteConnection);

module.exports = router;
