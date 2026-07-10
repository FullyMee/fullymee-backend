const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { getRequestToken, verifyAuthToken } = require('../utils/authToken');
const metrics = require('../metrics/prometheus');

function parsePositiveInt(value, fallback) {
    const raw = Number(value);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function getRateLimitWindowMs(envName, fallbackMs) {
    return parsePositiveInt(process.env[envName], fallbackMs);
}

function getRateLimitMax(envName, fallbackMax) {
    return parsePositiveInt(process.env[envName], fallbackMax);
}

function getClientIp(req) {
    if (!req) return 'unknown';
    return String(req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown');
}

function getRouteLabel(req) {
    const path = (req.baseUrl || '') + (req.path || '');
    return `${req.method} ${path || req.originalUrl || 'unknown'}`;
}

function getRetryAfter(req, windowMs) {
    if (req && req.rateLimit && req.rateLimit.resetTime instanceof Date) {
        return Math.max(1, Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000));
    }
    return Math.max(1, Math.ceil(windowMs / 1000));
}

function getAuthClaims(req) {
    if (req && req.user && req.user.userId) {
        return req.user;
    }
    if (!req) return null;

    const token = getRequestToken(req);
    if (!token) return null;

    try {
        return verifyAuthToken(token);
    } catch (_) {
        return null;
    }
}

function createRateLimitHandler(type, windowMs) {
    return (req, res /* , next */) => {
        const retryAfterSec = getRetryAfter(req, windowMs);
        res.set('Retry-After', String(retryAfterSec));
        const userId = req.user?.userId || req.rateLimitIdentity?.userId || null;
        const ip = getClientIp(req);
        console.warn('Rate limit exceeded', {
            type,
            userId,
            ip,
            path: getRouteLabel(req),
            method: req.method,
            retryAfterSec
        });

        metrics.recordApiRateLimit({
            type,
            method: req.method,
            endpoint: getRouteLabel(req)
        });

        return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    };
}

function getAuthEntryEmail(req) {
    if (!req || !req.body) return null;

    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    if (email) {
        return email;
    }

    const credential = typeof req.body.credential === 'string' ? req.body.credential.trim() : null;
    if (!credential) {
        return null;
    }

    try {
        const decoded = jwt.decode(credential, { complete: true });
        const payload = decoded && decoded.payload ? decoded.payload : decoded;
        const tokenEmail = payload && (payload.email || payload.email_address || payload.emailAddress);
        return typeof tokenEmail === 'string' ? tokenEmail.trim().toLowerCase() : null;
    } catch (error) {
        return null;
    }
}

function createAuthEntryEmailLimiter(max = 5, windowMs = 60 * 1000, label = 'auth-email') {
    return rateLimit({
        windowMs,
        max,
        keyGenerator: (req) => {
            const email = getAuthEntryEmail(req);
            return email ? `email:${email}` : rateLimit.ipKeyGenerator(req);
        },
        skip: (req) => !getAuthEntryEmail(req),
        standardHeaders: true,
        legacyHeaders: false,
        handler: createRateLimitHandler(label, windowMs)
    });
}

function createAuthEntryIpLimiter(max = 60, windowMs = 60 * 1000, label = 'auth-ip') {
    return rateLimit({
        windowMs,
        max,
        keyGenerator: rateLimit.ipKeyGenerator,
        standardHeaders: true,
        legacyHeaders: false,
        handler: createRateLimitHandler(label, windowMs)
    });
}

exports.hydrateRateLimitIdentity = (req, res, next) => {
    const claims = getAuthClaims(req);
    if (claims && claims.userId) {
        req.rateLimitIdentity = claims;
    }
    next();
};

exports.apiUserLimiter = rateLimit({
    windowMs: getRateLimitWindowMs('API_RATE_LIMIT_USER_WINDOW_MS', 60 * 1000),
    max: getRateLimitMax('API_RATE_LIMIT_USER_MAX', 120),
    keyGenerator: (req) => {
        const claims = req.user || req.rateLimitIdentity;
        return claims && claims.userId ? `user:${String(claims.userId)}` : getClientIp(req);
    },
    skip: (req) => {
        const claims = req.user || req.rateLimitIdentity;
        return !claims || !claims.userId;
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
        return createRateLimitHandler('user', getRateLimitWindowMs('API_RATE_LIMIT_USER_WINDOW_MS', 60 * 1000))(req, res);
    }
});

exports.apiIpLimiter = rateLimit({
    windowMs: getRateLimitWindowMs('API_RATE_LIMIT_IP_WINDOW_MS', 60 * 1000),
    max: getRateLimitMax('API_RATE_LIMIT_IP_MAX', 1200),
    standardHeaders: true,
    legacyHeaders: false,
    handler: createRateLimitHandler('ip', getRateLimitWindowMs('API_RATE_LIMIT_IP_WINDOW_MS', 60 * 1000))
});

/* Separate buckets so request and verify do not consume each other. */
exports.requestOtpLimiter = [
    createAuthEntryEmailLimiter(getRateLimitMax('AUTH_REQUEST_EMAIL_MAX', 5), getRateLimitWindowMs('AUTH_REQUEST_EMAIL_WINDOW_MS', 60 * 1000), 'auth-request-email'),
    createAuthEntryIpLimiter(getRateLimitMax('AUTH_REQUEST_IP_MAX', 60), getRateLimitWindowMs('AUTH_REQUEST_IP_WINDOW_MS', 60 * 1000), 'auth-request-ip')
];

exports.verifyOtpLimiter = [
    createAuthEntryEmailLimiter(getRateLimitMax('AUTH_VERIFY_EMAIL_MAX', 8), getRateLimitWindowMs('AUTH_VERIFY_EMAIL_WINDOW_MS', 60 * 1000), 'auth-verify-email'),
    createAuthEntryIpLimiter(getRateLimitMax('AUTH_VERIFY_IP_MAX', 80), getRateLimitWindowMs('AUTH_VERIFY_IP_WINDOW_MS', 60 * 1000), 'auth-verify-ip')
];

exports.googleSigninLimiter = [
    createAuthEntryEmailLimiter(getRateLimitMax('AUTH_GOOGLE_EMAIL_MAX', 5), getRateLimitWindowMs('AUTH_GOOGLE_EMAIL_WINDOW_MS', 60 * 1000), 'auth-google-email'),
    createAuthEntryIpLimiter(getRateLimitMax('AUTH_GOOGLE_IP_MAX', 60), getRateLimitWindowMs('AUTH_GOOGLE_IP_WINDOW_MS', 60 * 1000), 'auth-google-ip')
];
