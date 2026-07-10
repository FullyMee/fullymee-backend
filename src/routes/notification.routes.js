const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModerationAdmin } = require('../middleware/admin.middleware');

router.post('/test-email', authenticate, requireModerationAdmin, notificationController.testEmail);

module.exports = router;
