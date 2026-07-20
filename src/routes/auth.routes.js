const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const { requestOtpLimiter, verifyOtpLimiter, googleSigninLimiter } = require('../middleware/rateLimit.middleware');

/* Auth entry rates are protected by combined per-email/account and shared IP limits.
   This keeps authentication available for many users behind one shared IP while blocking abuse. */
router.post('/request-otp', ...requestOtpLimiter, authController.requestOTP);
router.get('/check-username', authController.checkUsername);
router.get('/csrf', authController.getCsrfToken);

router.post('/verify-otp', ...verifyOtpLimiter, authController.verifyOTP);
router.post('/google-signin', ...googleSigninLimiter, authController.googleSignIn);
router.post('/refresh', authController.refreshSession);
router.post('/logout', authenticate, authController.logout);
router.get('/socket-token', authenticate, authController.getSocketToken);

router.get('/users', authenticate, authController.getAllUsers);

module.exports = router;
