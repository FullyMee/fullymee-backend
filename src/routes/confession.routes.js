const express = require('express');
const router = express.Router();

const confessionController = require('../controllers/confession.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModerationAdmin } = require('../middleware/admin.middleware');

router.post('/rooms/join', authenticate, confessionController.joinRoom);
router.post('/rooms', authenticate, confessionController.createRoom);
router.post('/rooms/join-by-code', authenticate, confessionController.joinRoomByCode);
router.post('/rooms/:roomId/leave', authenticate, confessionController.leaveRoom);
router.post('/rooms/:roomId/shuffle', authenticate, confessionController.shuffleAlias);
router.get('/rooms/:roomId/scheduled', authenticate, confessionController.listMyScheduledConfessions);
router.post('/rooms/:roomId/scheduled/:confessionId/confirm', authenticate, confessionController.confirmPublishConfession);
router.delete('/rooms/:roomId/scheduled/:confessionId', authenticate, confessionController.cancelScheduledConfession);
router.get('/rooms/my', authenticate, confessionController.getMyRooms);
router.get('/rooms/public', authenticate, confessionController.getPublicRooms);
router.get('/rooms/:roomId/members', authenticate, confessionController.getRoomMembers);
router.get('/rooms/:roomId/audio-token', authenticate, confessionController.getAudioUploadToken);
router.get('/posts/my', authenticate, confessionController.getMyConfessions);
router.get('/rooms/recommendations', authenticate, confessionController.getRecommendations);

router.get('/rooms/:roomId/confessions', authenticate, confessionController.listConfessions);
router.post('/rooms/:roomId/confessions', authenticate, confessionController.postConfession);
router.get('/rooms/:roomId/confessions/:confessionId/audio-url', authenticate, confessionController.getConfessionAudioUrl);

router.get('/rooms/:roomId/confessions/:confessionId/replies', authenticate, confessionController.listReplies);
router.post('/rooms/:roomId/confessions/:confessionId/replies', authenticate, confessionController.postReply);
router.post('/rooms/:roomId/confessions/:confessionId/chat-request', authenticate, confessionController.sendChatRequest);

router.post('/rooms/:roomId/reactions', authenticate, confessionController.react);
router.post('/rooms/:roomId/reports', authenticate, confessionController.report);

router.get('/analytics/summary', authenticate, confessionController.analyticsSummary);
router.get('/moderation/queue', authenticate, requireModerationAdmin, confessionController.listModerationQueue);
// FullyMee Likes & Feed Routes
router.post('/:id/like', authenticate, confessionController.likeConfession);
router.post('/replies/:id/like', authenticate, confessionController.likeReply);
router.post('/', authenticate, confessionController.createConfession);
router.get('/', authenticate, confessionController.listConfessionsFeed);

module.exports = router;
