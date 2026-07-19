const { getCookieValue } = require('../utils/authToken');

const PUBLIC_AUTH_PATHS = new Set([
    '/api/auth/request-otp',
    '/api/auth/verify-otp',
    '/api/auth/google-signin'
]);

function isSafeMethod(method) {
    return ['GET', 'HEAD', 'OPTIONS'].includes(String(method || '').toUpperCase());
}

function getCsrfTokenHeader(req) {
    return String(req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || '').trim();
}

function getCsrfCookie(req) {
    return getCookieValue(req.headers && req.headers.cookie, process.env.CSRF_COOKIE_NAME || 'csrf_token');
}

module.exports = function verifyCsrfToken(req, res, next) {
    if (isSafeMethod(req.method) || PUBLIC_AUTH_PATHS.has(req.path)) {
        return next();
    }

    const headerToken = getCsrfTokenHeader(req);
    const cookieToken = getCsrfCookie(req);

    console.log("Origin:", req.headers.origin);
    console.log("Cookie Header:", req.headers.cookie);
    console.log("Header Token:", headerToken);
    console.log("Cookie Token:", cookieToken);

    if (!headerToken || !cookieToken || headerToken !== cookieToken) {
        return res.status(403).json({ error: "Invalid CSRF token" });
    }

    next();
};
