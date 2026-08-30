const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { sendOTPEmail } = require('../utils/email.notification');
const { getCookieValue } = require('../utils/authToken');
const metrics = require('../metrics/prometheus');
const User = require('../models/user.model');
const OtpRequest = require('../models/otpRequest.model');
const RefreshToken = require('../models/refreshToken.model');
const { getNextSequence } = require('../utils/sequence');
const { signAuthToken } = require('../utils/authToken');
const {
    rememberEmail,
    rememberUsername,
    mightHaveEmail,
    mightHaveUsername
} = require('./bloomFilter.service');

const OTP_LOCKED_ERROR_MESSAGE = 'Too many invalid attempts. Try again later';
const REFRESH_TOKEN_EXPIRES_MS = Number(process.env.REFRESH_TOKEN_EXPIRES_MS || 30 * 24 * 60 * 60 * 1000);
const AUTH_TOKEN_EXPIRES_IN = String(process.env.JWT_EXPIRES_IN || '15m').trim();
const EXPECTED_REFRESH_ERROR_CODES = new Set([
    'REFRESH_INVALID',
    'REFRESH_MISSING',
    'REFRESH_REVOKED',
    'REFRESH_REUSE'
]);
const ANONYMOUS_USERNAME_ADJECTIVES = [
    'silent', 'hidden', 'curious', 'brave', 'calm', 'fuzzy', 'clever', 'wild', 'gentle', 'misty',
    'rapid', 'serene', 'lively', 'nimble', 'bold', 'cosmic', 'bright', 'quiet', 'amber', 'velvet'
];
const ANONYMOUS_USERNAME_NOUNS = [
    'tiger', 'falcon', 'otter', 'fox', 'panda', 'raven', 'dolphin', 'lynx', 'wolf', 'sparrow',
    'leopard', 'koala', 'eagle', 'hawk', 'seal', 'jaguar', 'panther', 'manta', 'cobra', 'orca'
];

function logAuthEvent(event, details = {}) {
    try {
        const payload = {
            event: String(event || 'auth_event'),
            ...details
        };
        console.warn('Auth event:', JSON.stringify(payload));
    } catch (_) {
        console.warn('Auth event:', event, details);
    }
}

function generateRandomOTP() {
    const otp = crypto.randomInt(0, 1000000);
    return String(otp).padStart(6, '0');
}

function hashRefreshToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function randomFrom(values) {
    if (!values || !values.length) return '';
    return values[crypto.randomInt(0, values.length)];
}

function getClientIp(req) {
    if (!req) return 'unknown';
    const forwarded = req.headers && req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return String(req.ip || req.connection?.remoteAddress || 'unknown');
}

async function createRefreshTokenForUser(userId, tokenVersion, req) {
    const token = crypto.randomBytes(64).toString('hex');
    const tokenHash = hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

    await RefreshToken.create({
        tokenHash,
        userId: Number(userId),
        tokenVersionAtIssue: Number(tokenVersion || 0),
        createdByIp: getClientIp(req),
        userAgent: String(req.headers && req.headers['user-agent'] || '').slice(0, 255),
        expiresAt
    });

    return token;
}

async function revokeRefreshTokensForUser(userId) {
    const result = await RefreshToken.updateMany(
        { userId: Number(userId), revokedAt: null },
        { $set: { revokedAt: new Date() } }
    );
    if (result && result.modifiedCount > 0) {
        metrics.recordAuthTokenRevoked();
    }
}

async function handleRefreshTokenReuse(existing) {
    if (!existing || !existing.userId) return;

    await RefreshToken.updateOne(
        { tokenHash: existing.tokenHash },
        { $set: { reuseDetectedAt: new Date() } }
    );
    await User.updateOne(
        { id: Number(existing.userId) },
        { $inc: { tokenVersion: 1 } }
    );
    await revokeRefreshTokensForUser(existing.userId);
    metrics.recordAuthTokenVersionMismatch();
}

async function rotateRefreshToken(rawToken, req) {
    const existingHash = hashRefreshToken(rawToken);
    const existing = await RefreshToken.findOne({ tokenHash: existingHash }).lean();

    if (existing && existing.revokedAt) {
        await handleRefreshTokenReuse(existing);
        const err = new Error('Refresh token reuse detected');
        err.code = 'REFRESH_REUSE';
        throw err;
    }

    if (!existing || !existing.expiresAt || existing.expiresAt.getTime() <= Date.now()) {
        const err = new Error('Refresh token is invalid or expired');
        err.code = 'REFRESH_INVALID';
        throw err;
    }

    const user = await User.findOne({ id: Number(existing.userId) }).lean();
    if (!user) {
        const err = new Error('Refresh token user not found');
        err.code = 'REFRESH_INVALID';
        throw err;
    }

    if (Number(user.tokenVersion || 0) !== Number(existing.tokenVersionAtIssue || 0)) {
        const err = new Error('Refresh token has been revoked');
        err.code = 'REFRESH_REVOKED';
        throw err;
    }

    await RefreshToken.updateOne({ tokenHash: existingHash }, { $set: { revokedAt: new Date() } });
    const freshToken = await createRefreshTokenForUser(user.id, user.tokenVersion, req);

    return { user, refreshToken: freshToken };
}

async function getRefreshTokenFromRequest(req) {
    if (!req) return null;
    const rawCookie = getCookieValue(req.headers && req.headers.cookie, process.env.REFRESH_COOKIE_NAME || 'refresh_token');
    return rawCookie || null;
}

async function refreshSession(req) {
    const rawRefreshToken = await getRefreshTokenFromRequest(req);
    if (!rawRefreshToken) {
        const err = new Error('Refresh token missing');
        err.code = 'REFRESH_MISSING';
        metrics.recordAuthRefreshFailure();
        throw err;
    }

    try {
        const { user, refreshToken } = await rotateRefreshToken(rawRefreshToken, req);
        const authToken = signAuthToken(user, { expiresIn: AUTH_TOKEN_EXPIRES_IN });
        metrics.recordAuthRefreshSuccess();
        return { user, authToken, refreshToken };
    } catch (err) {
        metrics.recordAuthRefreshFailure();
        if (!EXPECTED_REFRESH_ERROR_CODES.has(err && err.code)) {
            logAuthEvent('refresh_failed', {
                error: err && err.code ? String(err.code) : 'UNKNOWN',
                message: err && err.message ? String(err.message) : 'Refresh failed'
            });
        }
        throw err;
    }
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
}

function isValidUsername(username) {
    return /^[a-z0-9._]{3,20}$/.test(username);
}

function buildUsernameFromEmail(email, fallbackSuffix = '') {
    const local = String(email || '').split('@')[0] || '';
    const cleaned = local.toLowerCase().replace(/[^a-z0-9._]/g, '');
    const base = cleaned.length >= 3 ? cleaned : `user${fallbackSuffix || ''}`;
    return base.slice(0, 20);
}

function createAnonymousUsernameCandidate() {
    const suffix = crypto.randomInt(1000, 10000);
    return `${randomFrom(ANONYMOUS_USERNAME_ADJECTIVES)}.${randomFrom(ANONYMOUS_USERNAME_NOUNS)}${suffix}`;
}

async function getUniqueUsername(base, suffixSeed = 0) {
    let candidate = String(base || '').slice(0, 20);
    if (!isValidUsername(candidate)) {
        candidate = `user${String(suffixSeed || '').replace(/\D/g, '')}`.slice(0, 20);
    }
    if (!candidate) candidate = 'user001';

    let attempt = 0;
    while (attempt < 100) {
        if (!mightHaveUsername(candidate)) return candidate;
        const exists = await User.findOne({ username: candidate })
            .select({ _id: 0, id: 1 })
            .lean();
        if (!exists) return candidate;

        attempt += 1;
        const suffix = String((suffixSeed || Date.now()) + attempt).replace(/\D/g, '').slice(-4);
        const trimmedBase = candidate.slice(0, Math.max(3, 20 - suffix.length - 1));
        candidate = `${trimmedBase}_${suffix}`;
    }

    throw new Error('Unable to allocate a unique username');
}

async function ensureLegacyUsersHaveUsername() {
    const legacyUsers = await User.find({
        $or: [
            { username: { $exists: false } },
            { username: null },
            { username: '' }
        ]
    })
        .select({ _id: 0, id: 1, email: 1 })
        .sort({ id: 1 })
        .lean();

    for (const legacyUser of legacyUsers) {
        const base = buildUsernameFromEmail(legacyUser.email, legacyUser.id);
        const username = await getUniqueUsername(base, legacyUser.id);
        await User.updateOne(
            { id: legacyUser.id },
            { $set: { username } }
        );
        rememberUsername(username);
    }
}

async function createUserByEmail(email, username) {
    const nextId = await getNextSequence('users');
    const normalizedUsername = normalizeUsername(username);
    const hasPreferredUsername = Boolean(normalizedUsername);
    let candidate = normalizedUsername || buildUsernameFromEmail(email, nextId);

    if (!isValidUsername(candidate)) {
        candidate = buildUsernameFromEmail(email, nextId);
    }

    if (!isValidUsername(candidate)) {
        candidate = `user${String(nextId).slice(-4).padStart(3, '0')}`;
    }

    let attempt = 0;
    while (attempt < 50) {
        try {
            const created = await User.create({
                id: nextId,
                email,
                username: candidate,
                authProviders: ['email'],
                role: 'user'
            });
            rememberEmail(email);
            rememberUsername(candidate);
            return {
                id: created.id,
                email: created.email,
                username: created.username,
                role: created.role,
                tokenVersion: created.tokenVersion
            };
        } catch (err) {
            if (err && err.code === 11000) {
                if (String(err.message || '').toLowerCase().includes('username') || (err.keyPattern && err.keyPattern.username)) {
                    if (hasPreferredUsername) {
                        const error = new Error('Username is not available');
                        error.code = 'USERNAME_UNAVAILABLE';
                        error.status = 409;
                        throw error;
                    }
                    candidate = await getUniqueUsername(buildUsernameFromEmail(email, nextId), nextId + attempt);
                    attempt += 1;
                    continue;
                }

                if (String(err.message || '').toLowerCase().includes('email') || (err.keyPattern && err.keyPattern.email)) {
                    const existing = await User.findOne({ email }).lean();
                    if (existing) {
                        return existing;
                    }
                }
            }
            throw err;
        }
    }

    throw new Error('Unable to allocate a unique username');
}

async function createGoogleUser(email, googleSub) {
    const nextId = await getNextSequence('users');

    for (let attempt = 0; attempt < 60; attempt += 1) {
        const candidate = createAnonymousUsernameCandidate();
        const usernameExists = mightHaveUsername(candidate)
            ? await User.exists({ username: candidate })
            : null;
        if (usernameExists) continue;

        try {
            const created = await User.create({
                id: nextId,
                email,
                googleSub,
                username: candidate,
                authProviders: ['google'],
                role: 'user'
            });
            rememberEmail(email);
            rememberUsername(candidate);
            return {
                id: created.id,
                email: created.email,
                username: created.username,
                role: created.role,
                tokenVersion: created.tokenVersion,
                googleSub: created.googleSub
            };
        } catch (err) {
            if (err && err.code === 11000) {
                const duplicateEmail = String(err.message || '').toLowerCase().includes('email') || (err.keyPattern && err.keyPattern.email);
                const duplicateGoogleSub = String(err.message || '').toLowerCase().includes('googlesub') || (err.keyPattern && err.keyPattern.googleSub);
                const duplicateUsername = String(err.message || '').toLowerCase().includes('username') || (err.keyPattern && err.keyPattern.username);
                if (duplicateUsername) continue;
                if (duplicateEmail || duplicateGoogleSub) {
                    const existing = await User.findOne({
                        $or: [{ email }, { googleSub }]
                    })
                        .select({ _id: 0, id: 1, email: 1, username: 1, role: 1, tokenVersion: 1, googleSub: 1 })
                        .lean();
                    if (existing) return existing;
                }
            }
            throw err;
        }
    }

    throw new Error('Unable to allocate a unique username');
}

async function upsertOtpRequest({ email, otpHash, expiresAt }) {
    await OtpRequest.findOneAndUpdate(
        { email },
        {
            email,
            otpHash,
            expiresAt,
            failedAttempts: 0,
            lockUntil: null
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

function createOtpLockedError(retryAfterSec) {
    const err = new Error(OTP_LOCKED_ERROR_MESSAGE);
    err.code = 'OTP_LOCKED';
    err.retryAfterSec = Number(retryAfterSec) > 0 ? Math.ceil(Number(retryAfterSec)) : undefined;
    return err;
}

function getMaxVerifyAttempts() {
    const value = Number(process.env.OTP_VERIFY_MAX_ATTEMPTS || 5);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5;
}

function getVerifyLockWindowMs() {
    const lockMin = Number(process.env.OTP_VERIFY_LOCK_MIN || 15);
    const safeMin = Number.isFinite(lockMin) && lockMin > 0 ? lockMin : 15;
    return safeMin * 60 * 1000;
}

async function verifyGoogleCredential(idToken) {
    const token = String(idToken || '').trim();
    if (!token) {
        throw new Error('Google credential is required');
    }

    const expectedAudience = String(process.env.GOOGLE_CLIENT_ID || '').trim();
    if (!expectedAudience) {
        throw new Error('Google Sign-In is not configured on server');
    }

    const client = new OAuth2Client(expectedAudience);
    let payload;
    try {
        const ticket = await client.verifyIdToken({ idToken: token, audience: expectedAudience });
        payload = ticket.getPayload();
    } catch (err) {
        const message = err && err.message ? err.message : 'Invalid Google credential';
        throw new Error(message.includes('Audience') ? 'Google credential audience mismatch' : 'Invalid Google credential');
    }

    const email = normalizeEmail(payload.email);
    const emailVerified = String(payload.email_verified || payload.emailVerified || '').toLowerCase() === 'true';
    if (!email || !emailVerified) {
        throw new Error('Google email is not verified');
    }

    return { email, googleSub: String(payload.sub || '').trim() };
}

exports.generateOTP = async (email) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Email is required');

    metrics.recordAuthOtpRequest();

    const existing = await OtpRequest.findOne({ email: normalizedEmail })
        .select({ _id: 0, lockUntil: 1 })
        .lean();
    const now = Date.now();
    if (existing && existing.lockUntil) {
        const lockUntilMs = new Date(existing.lockUntil).getTime();
        if (Number.isFinite(lockUntilMs) && lockUntilMs > now) {
            const retryAfterSec = Math.max(1, Math.ceil((lockUntilMs - now) / 1000));
            throw createOtpLockedError(retryAfterSec);
        }
    }

    const otp = generateRandomOTP();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresMin = Number(process.env.OTP_EXPIRES_MIN || 5);
    const expiresAt = new Date(Date.now() + expiresMin * 60 * 1000);

    await upsertOtpRequest({ email: normalizedEmail, otpHash, expiresAt });

    // Fail closed in production unless explicit dev bypass is enabled.
    try {
        await sendOTPEmail(normalizedEmail, otp);
    } catch (err) {
        metrics.recordAuthOtpSendFailure();
        console.error('Email OTP delivery failed:', err && err.message ? err.message : err);
        const allowBypass = String(process.env.ALLOW_DEV_OTP_BYPASS || '').toLowerCase() === 'true';
        if (!allowBypass) {
            throw new Error('Failed to send OTP email');
        }
        console.log(`DEV OTP for ${normalizedEmail}: ${otp}`);
    }
};

exports.verifyOTP = async (email, otp, usernameInput) => {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Email is required');
    const normalizedUsername = normalizeUsername(usernameInput);

    const record = await OtpRequest.findOne({ email: normalizedEmail }).lean();

    if (!record) {
        metrics.recordAuthOtpFailed();
        logAuthEvent('otp_not_requested', { email: normalizedEmail });
        throw new Error('OTP not requested');
    }

    const now = Date.now();
    const maxVerifyAttempts = getMaxVerifyAttempts();
    const verifyLockWindowMs = getVerifyLockWindowMs();

    if (record.lockUntil) {
        const lockUntilMs = new Date(record.lockUntil).getTime();

        if (Number.isFinite(lockUntilMs) && lockUntilMs > now) {
            const retryAfterSec = Math.max(1, Math.ceil((lockUntilMs - now) / 1000));
            metrics.recordAuthOtpLocked();
            throw createOtpLockedError(retryAfterSec);
        }

        await OtpRequest.updateOne(
            { email: normalizedEmail },
            { $set: { failedAttempts: 0, lockUntil: null } }
        );
    }

    if (now > new Date(record.expiresAt).getTime()) {
        metrics.recordAuthOtpFailed();
        logAuthEvent('otp_expired', { email: normalizedEmail });
        throw new Error('OTP expired');
    }

    const valid = await bcrypt.compare(otp, record.otpHash);

    if (!valid) {
        const failedAttempts = Number(record.failedAttempts || 0) + 1;

        if (failedAttempts >= maxVerifyAttempts) {
            const lockUntil = new Date(now + verifyLockWindowMs);
            await OtpRequest.updateOne(
                { email: normalizedEmail },
                { $set: { failedAttempts: 0, lockUntil } }
            );

            metrics.recordAuthOtpLocked();
            logAuthEvent('otp_account_locked', { email: normalizedEmail, lockUntil: lockUntil.toISOString() });
            throw createOtpLockedError(Math.ceil(verifyLockWindowMs / 1000));
        }

        await OtpRequest.updateOne(
            { email: normalizedEmail },
            { $set: { failedAttempts, lockUntil: null } }
        );

        metrics.recordAuthOtpFailed();
        logAuthEvent('otp_invalid', { email: normalizedEmail, failedAttempts });
        throw new Error('Invalid OTP');
    }

    let user = mightHaveEmail(normalizedEmail)
        ? await User.findOne({ email: normalizedEmail }).lean()
        : null;
    if (!user) {
        if (!normalizedUsername) {
            throw new Error('Username is required');
        }
        if (!isValidUsername(normalizedUsername)) {
            throw new Error('Username must be 3-20 chars (a-z, 0-9, . and _)');
        }

        const existingUsername = await User.findOne({ username: normalizedUsername })
            .select({ _id: 0, id: 1 })
            .lean();
        if (existingUsername) {
            throw new Error('Username is not available');
        }

        user = await createUserByEmail(normalizedEmail, normalizedUsername);
    } else if (!user.username) {
        if (!normalizedUsername) {
            throw new Error('Username is required');
        }
        if (!isValidUsername(normalizedUsername)) {
            throw new Error('Username must be 3-20 chars (a-z, 0-9, . and _)');
        }

        try {
            const update = await User.updateOne(
                {
                    id: user.id,
                    $or: [{ username: null }, { username: '' }]
                },
                { $set: { username: normalizedUsername } }
            );

            if (!update.matchedCount || !update.modifiedCount) {
                throw new Error('Username is not available');
            }
        } catch (err) {
            if (err && err.code === 11000) {
                throw new Error('Username is not available');
            }
            throw err;
        }

        user = { ...user, username: normalizedUsername };
        rememberUsername(normalizedUsername);
    }

    const token = signAuthToken({
        userId: user.id,
        email: user.email || normalizedEmail,
        username: user.username || normalizedUsername,
        role: user.role,
        tokenVersion: user.tokenVersion
    });

    metrics.recordAuthLoginSuccess();
    await OtpRequest.deleteOne({ email: normalizedEmail });

    return { token, user };
};

exports.loginWithGoogle = async (credential, intent = '') => {
    try {
        const { email, googleSub } = await verifyGoogleCredential(credential);
        if (!googleSub) {
            throw new Error('Invalid Google credential');
        }

        const googleUser = await User.findOne({ googleSub })
            .select({ _id: 0, id: 1, email: 1, username: 1, role: 1, tokenVersion: 1, googleSub: 1 })
            .lean();
        const emailUser = mightHaveEmail(email)
            ? await User.findOne({ email })
                .select({ _id: 0, id: 1, email: 1, username: 1, role: 1, tokenVersion: 1, googleSub: 1 })
                .lean()
            : null;

        if (googleUser && emailUser && Number(googleUser.id) !== Number(emailUser.id)) {
            const err = new Error('This Google account is already linked to another user.');
            err.code = 'GOOGLE_ACCOUNT_CONFLICT';
            throw err;
        }

        let user = googleUser || emailUser;

        const normalizedIntent = String(intent || '').trim().toLowerCase();

        // If intent is 'signin' and user does not exist in database:
        if (!user && normalizedIntent === 'signin') {
            const err = new Error('User does not exist, sign up first.');
            err.code = 'GOOGLE_SIGNIN_NO_ACCOUNT';
            throw err;
        }

        if (!user) {
            user = await createGoogleUser(email, googleSub);
        } else if (!user.googleSub) {
            const updated = await User.findOneAndUpdate(
                { id: Number(user.id), $or: [{ googleSub: null }, { googleSub: { $exists: false } }] },
                {
                    $set: { googleSub },
                    $addToSet: { authProviders: 'google' }
                },
                {
                    new: true,
                    projection: { _id: 0, id: 1, email: 1, username: 1, role: 1, tokenVersion: 1, googleSub: 1 }
                }
            ).lean();
            user = updated || user;
        }

        const token = signAuthToken({
            userId: user.id,
            email: user.email,
            username: user.username || '',
            role: user.role,
            tokenVersion: user.tokenVersion
        });

        metrics.recordAuthLoginSuccess();
        return { token, user };
    } catch (err) {
        if (err && (err.code === 'GOOGLE_SIGNIN_NO_ACCOUNT' || err.code === 'GOOGLE_ACCOUNT_CONFLICT')) {
            throw err;
        }
        metrics.recordAuthGoogleSigninFailure();
        logAuthEvent('google_signin_failed', {
            error: err && err.code ? String(err.code) : 'UNKNOWN',
            message: err && err.message ? String(err.message) : 'Google sign-in validation failed'
        });
        throw err;
    }
};

exports.checkUsernameAvailability = async (usernameInput) => {
    const username = normalizeUsername(usernameInput);
    if (!username) {
        return { available: false, reason: 'Username is required', username: '' };
    }
    if (!isValidUsername(username)) {
        return { available: false, reason: 'Username must be 3-20 chars (a-z, 0-9, . and _)', username };
    }

    if (!mightHaveUsername(username)) {
        return {
            available: true,
            reason: '',
            username
        };
    }

    const exists = await User.findOne({ username })
        .select({ _id: 0, id: 1 })
        .lean();

    return {
        available: !exists,
        reason: exists ? 'Username is not available' : '',
        username
    };
};

exports.refreshSession = async (req) => {
    return refreshSession(req);
};

exports.revokeRefreshTokensForUser = async (userId) => {
    return revokeRefreshTokensForUser(userId);
};

exports.initializeIdentityData = async () => {
    await ensureLegacyUsersHaveUsername();
};

exports.createRefreshTokenForUser = async (userId, tokenVersion, req) => {
    return createRefreshTokenForUser(userId, tokenVersion, req);
};

exports.OTP_LOCKED_ERROR_MESSAGE = OTP_LOCKED_ERROR_MESSAGE;
