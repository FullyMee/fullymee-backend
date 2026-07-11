const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'auth_token';
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'refresh_token';
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'csrf_token';

const AUTH_COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const REFRESH_COOKIE_MAX_AGE_MS = Number(process.env.REFRESH_COOKIE_MAX_AGE_MS || 30 * 24 * 60 * 60 * 1000);
const CSRF_COOKIE_MAX_AGE_MS = Number(process.env.CSRF_COOKIE_MAX_AGE_MS || REFRESH_COOKIE_MAX_AGE_MS);

function parseBoolean(value, defaultValue) {
    if (value === undefined || value === null || value === '') return defaultValue;
    return String(value).toLowerCase() === 'true';
}

function normalizeKey(rawKey) {
    if (!rawKey) return '';
    return String(rawKey).replace(/\\r/g, '').replace(/\\n/g, '\n');
}

function parseCookies(cookieHeader) {
    const cookies = {};
    const header = String(cookieHeader || '');
    if (!header) return cookies;

    const pairs = header.split(';');
    for (const pair of pairs) {
        const index = pair.indexOf('=');
        if (index <= 0) continue;

        const key = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (!key) continue;

        try {
            cookies[key] = decodeURIComponent(value);
        } catch (err) {
            cookies[key] = value;
        }
    }
    return cookies;
}

function getCookieValue(cookieHeader, name) {
    const cookies = parseCookies(cookieHeader);
    return cookies[name] || null;
}

function getCookieToken(cookieHeader) {
    return getCookieValue(cookieHeader, AUTH_COOKIE_NAME);
}

function getBearerToken(authHeader) {
    const header = String(authHeader || '');
    if (!header.toLowerCase().startsWith('bearer ')) return null;
    const token = header.slice(7).trim();
    return token || null;
}

function getRequestToken(req) {
    if (!req) return null;
    return getBearerToken(req.headers && req.headers.authorization)
        || getCookieToken(req.headers && req.headers.cookie);
}

function getSocketToken(socket) {
    if (!socket || !socket.handshake) return null;
    const authToken = socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) return authToken;
    return getCookieToken(socket.handshake.headers && socket.handshake.headers.cookie);
}

function parseJwtAlgorithms() {
    return String(process.env.JWT_ALG || 'HS256')
        .split(',')
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean);
}

function getJwtSecretKey() {
    return String(process.env.JWT_SECRET || '').trim();
}

function getJwtPrivateKey() {
    return normalizeKey(process.env.JWT_PRIVATE_KEY || '');
}

function getJwtPublicKeys() {
    const rawSingle = normalizeKey(process.env.JWT_PUBLIC_KEY || '');
    const rawMultiple = String(process.env.JWT_PUBLIC_KEYS || '').trim();
    const keys = [];

    if (rawSingle) keys.push(rawSingle);

    if (rawMultiple) {
        let parsed;
        try {
            parsed = JSON.parse(rawMultiple);
        } catch (_err) {
            parsed = rawMultiple
                .split(/\s*[,;]\s*/)
                .map((value) => normalizeKey(value))
                .filter(Boolean);
        }

        if (Array.isArray(parsed)) {
            for (const key of parsed) {
                const normalized = normalizeKey(key);
                if (normalized) keys.push(normalized);
            }
        }
    }

    return keys;
}

function getJwtSigningKey() {
    const algorithms = parseJwtAlgorithms();
    const primaryAlg = algorithms[0] || 'HS256';

    if (primaryAlg.startsWith('HS')) {
        const secret = getJwtSecretKey();
        if (!secret) {
            throw new Error('JWT_SECRET is required for HMAC signing algorithms');
        }
        return secret;
    }

    if (primaryAlg.startsWith('RS') || primaryAlg.startsWith('ES') || primaryAlg.startsWith('PS')) {
        const privateKey = getJwtPrivateKey();
        if (!privateKey) {
            throw new Error('JWT_PRIVATE_KEY is required for asymmetric JWT signing algorithms');
        }
        return privateKey;
    }

    return getJwtSecretKey();
}

function getJwtVerifyKeys() {
    const algorithms = parseJwtAlgorithms();
    const primaryAlg = algorithms[0] || 'HS256';

    if (primaryAlg.startsWith('HS')) {
        const secret = getJwtSecretKey();
        if (!secret) {
            throw new Error('JWT_SECRET is required for HMAC verification');
        }
        return [secret];
    }

    const keys = getJwtPublicKeys();
    if (!keys.length) {
        throw new Error('JWT_PUBLIC_KEY or JWT_PUBLIC_KEYS is required for asymmetric JWT verification');
    }

    return keys;
}

function buildJwtVerifyOptions() {
    const options = {
        algorithms: parseJwtAlgorithms()
    };
    const aud = String(process.env.JWT_AUD || '').trim();
    const iss = String(process.env.JWT_ISS || '').trim();
    if (aud) options.audience = aud;
    if (iss) options.issuer = iss;
    return options;
}

function validateJwtConfig() {
    const algorithms = parseJwtAlgorithms();
    const primaryAlg = algorithms[0] || 'HS256';

    if (primaryAlg.startsWith('HS')) {
        const secret = getJwtSecretKey();
        if (!secret) {
            throw new Error('Missing required env JWT_SECRET for HS algorithms');
        }
        if (secret.length < 32) {
            console.warn('JWT_SECRET is shorter than the recommended 32 characters for production deployments.');
        }
        return;
    }

    if (primaryAlg.startsWith('RS') || primaryAlg.startsWith('ES') || primaryAlg.startsWith('PS')) {
        const privateKey = getJwtPrivateKey();
        const publicKeys = getJwtPublicKeys();
        if (!privateKey) {
            throw new Error('Missing required env JWT_PRIVATE_KEY for asymmetric JWT signing');
        }
        if (!publicKeys.length) {
            throw new Error('Missing required env JWT_PUBLIC_KEY or JWT_PUBLIC_KEYS for asymmetric JWT verification');
        }
        return;
    }

    if (!getJwtSecretKey()) {
        throw new Error('Missing required env JWT_SECRET for JWT signing');
    }
}

function validateCookieConfig() {
    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const secure = parseBoolean(process.env.AUTH_COOKIE_SECURE, production);
    const sameSite = String(process.env.AUTH_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
    const frontendOrigin = String(process.env.FRONTEND_ORIGIN || process.env.CLIENT_ORIGIN || '').trim();
    const apiOrigin = String(process.env.API_ORIGIN || process.env.BACKEND_ORIGIN || '').trim();
    let crossSite = false;

    try {
        if (frontendOrigin && apiOrigin) {
            crossSite = new URL(frontendOrigin).origin !== new URL(apiOrigin).origin;
        }
    } catch (_) {
        crossSite = false;
    }

    if (sameSite === 'none' && !secure) {
        const message = 'AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true.';
        if (production) throw new Error(message);
        console.warn(message);
    }

    if (production && crossSite && (sameSite !== 'none' || !secure)) {
        throw new Error('Cross-site frontend/backend auth requires AUTH_COOKIE_SAMESITE=none and AUTH_COOKIE_SECURE=true.');
    }
}

function buildAuthClaims(user = {}) {
    return {
        userId: Number(user.userId || user.id),
        email: String(user.email || '').trim().toLowerCase(),
        username: String(user.username || '').trim().toLowerCase(),
        role: user.role === 'admin' ? 'admin' : 'user',
        tokenVersion: Number(user.tokenVersion || 0)
    };
}

function signAuthToken(user, options = {}) {
    const claims = buildAuthClaims(user);
    const signOpts = {
        expiresIn: options.expiresIn || process.env.JWT_EXPIRES_IN || '15m',
        algorithm: parseJwtAlgorithms()[0] || 'HS256'
    };

    const aud = String(process.env.JWT_AUD || '').trim();
    const iss = String(process.env.JWT_ISS || '').trim();
    if (aud) signOpts.audience = aud;
    if (iss) signOpts.issuer = iss;

    const key = getJwtSigningKey();
    return jwt.sign(claims, key, signOpts);
}

function verifyAuthToken(token) {
    if (!token) return null;
    const verifyOpts = buildJwtVerifyOptions();
    const keys = getJwtVerifyKeys();
    let lastError = null;

    for (const key of keys) {
        try {
            return jwt.verify(token, key, verifyOpts);
        } catch (err) {
            lastError = err;
            if (err && err.name === 'JsonWebTokenError' && err.message === 'invalid signature') {
                continue;
            }
            throw err;
        }
    }

    if (lastError) {
        throw lastError;
    }

    return null;
}

function getCookieOptions({ httpOnly = true, maxAge = AUTH_COOKIE_MAX_AGE_MS } = {}) {
    const production = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const secure = parseBoolean(process.env.AUTH_COOKIE_SECURE, production);

    const rawSameSite = String(process.env.AUTH_COOKIE_SAMESITE || 'lax').trim().toLowerCase();
    let sameSite = rawSameSite === 'strict' || rawSameSite === 'none' ? rawSameSite : 'lax';
    if (sameSite === 'none' && !secure) sameSite = 'lax';

    return {
        httpOnly,
        secure,
        sameSite,
        path: '/',
        maxAge
    };
}

function setCookie(res, name, value, options = {}) {
    res.cookie(name, value, getCookieOptions(options));
}

function clearCookie(res, name, options = {}) {
    const opts = getCookieOptions(options);
    const base = {
        httpOnly: opts.httpOnly,
        secure: opts.secure,
        path: opts.path
    };

    res.clearCookie(name, {
        ...base,
        sameSite: opts.sameSite
    });
    res.clearCookie(name, {
        ...base,
        sameSite: 'lax'
    });
    res.clearCookie(name, {
        ...base,
        sameSite: 'strict'
    });
    res.clearCookie(name, {
        ...base,
        sameSite: 'none',
        secure: true
    });
    res.cookie(name, '', {
        ...base,
        sameSite: opts.sameSite,
        expires: new Date(0),
        maxAge: 0
    });
}

function setAuthCookie(res, token, options = {}) {
    setCookie(res, AUTH_COOKIE_NAME, token, { httpOnly: true, maxAge: options.maxAge || AUTH_COOKIE_MAX_AGE_MS });
}

function setRefreshCookie(res, token, options = {}) {
    setCookie(res, REFRESH_COOKIE_NAME, token, { httpOnly: true, maxAge: options.maxAge || REFRESH_COOKIE_MAX_AGE_MS });
}

function setCsrfCookie(res, token, options = {}) {
    setCookie(res, CSRF_COOKIE_NAME, token, { httpOnly: false, maxAge: options.maxAge || CSRF_COOKIE_MAX_AGE_MS });
}

function clearAuthCookie(res) {
    clearCookie(res, AUTH_COOKIE_NAME);
}

function clearRefreshCookie(res) {
    clearCookie(res, REFRESH_COOKIE_NAME);
}

function clearCsrfCookie(res) {
    clearCookie(res, CSRF_COOKIE_NAME, { httpOnly: false });
}

function clearSessionCookies(res) {
    clearAuthCookie(res);
    clearRefreshCookie(res);
    clearCsrfCookie(res);
}

module.exports = {
    AUTH_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    AUTH_COOKIE_MAX_AGE_MS,
    REFRESH_COOKIE_MAX_AGE_MS,
    CSRF_COOKIE_MAX_AGE_MS,
    parseBoolean,
    parseCookies,
    getCookieValue,
    getCookieToken,
    getBearerToken,
    getRequestToken,
    getSocketToken,
    parseJwtAlgorithms,
    validateJwtConfig,
    validateCookieConfig,
    signAuthToken,
    verifyAuthToken,
    setAuthCookie,
    setRefreshCookie,
    setCsrfCookie,
    clearAuthCookie,
    clearRefreshCookie,
    clearCsrfCookie,
    clearSessionCookies
};
