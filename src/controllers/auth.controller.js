const crypto = require('crypto');
const authService = require('../services/auth.service');
const User = require('../models/user.model');
const {
    setAuthCookie,
    setRefreshCookie,
    setCsrfCookie,
    clearSessionCookies,
    signAuthToken
} = require('../utils/authToken');

const VERIFY_OTP_PUBLIC_ERRORS = new Set([
    'Email and OTP are required',
    'Username is required',
    'Username must be 3-20 chars (a-z, 0-9, . and _)',
    'Username is not available',
    'Email is required',
    'OTP not requested',
    'OTP expired',
    'Invalid OTP',
    authService.OTP_LOCKED_ERROR_MESSAGE
]);

function issueSessionCookies(res, authToken, refreshToken) {
    if (!res) return;
    setAuthCookie(res, authToken);
    setRefreshCookie(res, refreshToken);
    const csrfToken = crypto.randomBytes(32).toString('hex');
    setCsrfCookie(res, csrfToken);
}

function isDuplicateUsernameError(err) {
    return !!(
        err &&
        err.code === 11000 &&
        (
            String(err.message || '').toLowerCase().includes('username') ||
            (err.keyPattern && err.keyPattern.username)
        )
    );
}

exports.requestOTP = async (req, res) => {
    try {
        const { email, intent } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = String(email || '').trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const existingUser = await User.findOne({ email: normalizedEmail })
            .select({ _id: 0, id: 1, username: 1 })
            .lean();

        const normalizedIntent = String(intent || '').trim().toLowerCase();
        if (normalizedIntent === 'signup' && existingUser) {
            return res.status(409).json({ error: 'User already exists. Please sign in with email OTP.' });
        }

        await authService.generateOTP(normalizedEmail);

        res.status(200).json({
            message: 'OTP sent',
            requiresUsername: !(existingUser && existingUser.username),
            hasAccount: !!existingUser
        });

    } catch (err) {
        if (err && err.code === 'OTP_LOCKED') {
            if (Number.isFinite(err.retryAfterSec)) {
                res.set('Retry-After', String(Math.max(1, Math.floor(err.retryAfterSec))));
            }
            return res.status(429).json({ error: authService.OTP_LOCKED_ERROR_MESSAGE });
        }

        console.error(err);
        const message = err && err.message ? err.message : 'Failed to request OTP';
        const status = message === 'Failed to send OTP email' ? 503 : 500;
        res.status(status).json({ error: message });
    }
};

exports.verifyOTP = async (req, res) => {
    try {
        const { email, otp, username } = req.body;

        if (!email || !otp) {
            return res.status(400).json({ error: 'Email and OTP are required' });
        }

        const { token, user } = await authService.verifyOTP(email, otp, username);
        issueSessionCookies(res, token, await authService.createRefreshTokenForUser(user.id, user.tokenVersion, req));

        res.status(200).json({ user });

    } catch (err) {
        if (err && err.code === 'OTP_LOCKED') {
            if (Number.isFinite(err.retryAfterSec)) {
                res.set('Retry-After', String(Math.max(1, Math.floor(err.retryAfterSec))));
            }
            return res.status(429).json({ error: authService.OTP_LOCKED_ERROR_MESSAGE });
        }

        if (isDuplicateUsernameError(err)) {
            return res.status(409).json({ error: 'Username is not available' });
        }

        const message = err && err.message ? err.message : '';
        if (VERIFY_OTP_PUBLIC_ERRORS.has(message)) {
            return res.status(400).json({ error: message });
        }

        console.error('verifyOTP failed:', err);
        return res.status(500).json({ error: 'Failed to verify OTP' });
    }
};

exports.refreshSession = async (req, res) => {
    try {
        const { user, authToken, refreshToken } = await authService.refreshSession(req);
        issueSessionCookies(res, authToken, refreshToken);
        return res.status(200).json({ user });
    } catch (err) {
        clearSessionCookies(res);
        const message = err && err.message ? err.message : 'Failed to refresh session';
        console.error('refreshSession failed:', err);
        return res.status(401).json({ error: message });
    }
};

exports.googleSignIn = async (req, res) => {
    try {
        const credential = String((req.body && req.body.credential) || '').trim();
        if (!credential) {
            return res.status(400).json({ error: 'Google credential is required' });
        }

        const { token, user } = await authService.loginWithGoogle(credential);
        issueSessionCookies(res, token, await authService.createRefreshTokenForUser(user.id, user.tokenVersion, req));
        return res.status(200).json({ user });
    } catch (err) {
        if (err && err.code === 'GOOGLE_SIGNIN_NO_ACCOUNT') {
            return res.status(404).json({ error: err.message });
        }

        const message = err && err.message ? err.message : '';
        if (
            message === 'Google email is not verified' ||
            message === 'Google Sign-In is not configured on server' ||
            message === 'Google credential audience mismatch' ||
            message === 'Invalid Google credential' ||
            message === 'Unable to validate Google credential'
        ) {
            return res.status(400).json({ error: message });
        }

        console.error('googleSignIn failed:', err);
        return res.status(500).json({ error: 'Failed to sign in with Google' });
    }
};

exports.logout = async (req, res) => {
    try {
        // require authenticated user to perform logout and token revocation
        if (!req.user || !req.user.userId) {
            clearSessionCookies(res);
            return res.status(204).send();
        }

        try {
            await User.updateOne({ id: Number(req.user.userId) }, { $inc: { tokenVersion: 1 } });
            await authService.revokeRefreshTokensForUser(req.user.userId);
        } catch (e) {
            console.error('Failed to revoke session tokens on logout:', e && e.message ? e.message : e);
        }

        clearSessionCookies(res);
        return res.status(204).send();
    } catch (err) {
        clearSessionCookies(res);
        return res.status(204).send();
    }
};

exports.getSocketToken = async (req, res) => {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = signAuthToken(req.user, {
            expiresIn: process.env.SOCKET_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '7d'
        });

        return res.status(200).json({ token });
    } catch (err) {
        console.error('Failed to issue socket token:', err);
        return res.status(500).json({ error: 'Failed to issue socket token' });
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        if (process.env.ENABLE_USER_DISCOVERY !== 'true') {
            const paginate = String((req.query && req.query.paginate) || '').toLowerCase() === '1' || String((req.query && req.query.paginate) || '').toLowerCase() === 'true';
            return res.status(200).json(paginate ? { items: [], hasMore: false } : []);
        }

        const userId = req.user && req.user.userId;
        const query = String((req.query && req.query.q) || (req.query && req.query.search) || '').trim();
        const requestedLimit = Math.max(1, Math.min(100, Number(req.query && req.query.limit ? req.query.limit : 10) || 10));
        const offset = Math.max(0, Math.floor(Number(req.query && req.query.offset ? req.query.offset : 0) || 0));
        const paginate = String((req.query && req.query.paginate) || '').toLowerCase() === '1' || String((req.query && req.query.paginate) || '').toLowerCase() === 'true';

        const filter = { id: { $ne: userId } };
        if (query) {
            filter.username = { $regex: query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
        }

        const rows = await User.find(filter)
            .select({ _id: 0, id: 1, username: 1 })
            .sort({ id: 1 })
            .skip(offset)
            .limit(paginate ? requestedLimit + 1 : 0)
            .lean();

        if (paginate) {
            return res.status(200).json({
                items: rows.slice(0, requestedLimit),
                hasMore: rows.length > requestedLimit
            });
        }

        res.status(200).json(rows);
    } catch (err) {
        console.error("Failed to fetch users", err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
};

exports.checkUsername = async (req, res) => {
    try {
        const username = String((req.query && req.query.username) || '').trim();
        const result = await authService.checkUsernameAvailability(username);
        res.status(200).json(result);
    } catch (err) {
        console.error('checkUsername failed:', err);
        res.status(500).json({ error: 'Failed to check username' });
    }
};
