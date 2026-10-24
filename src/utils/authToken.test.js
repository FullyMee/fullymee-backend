import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const jwt = require('jsonwebtoken');
const {
    AUTH_COOKIE_NAME,
    REFRESH_COOKIE_NAME,
    CSRF_COOKIE_NAME,
    parseBoolean,
    parseCookies,
    getCookieValue,
    getCookieToken,
    getBearerToken,
    getRequestToken,
    getSocketToken,
    parseJwtAlgorithms,
    validateJwtConfig,
    signAuthToken,
    verifyAuthToken,
    clearSessionCookies
} = require('./authToken');

describe('authToken utilities', () => {
    describe('parseBoolean', () => {
        it('parses boolean strings correctly', () => {
            expect(parseBoolean('true', false)).toBe(true);
            expect(parseBoolean('TRUE', false)).toBe(true);
            expect(parseBoolean('false', true)).toBe(false);
            expect(parseBoolean('other', false)).toBe(false);
        });

        it('returns default value when input is undefined, null, or empty', () => {
            expect(parseBoolean(undefined, true)).toBe(true);
            expect(parseBoolean(null, false)).toBe(false);
            expect(parseBoolean('', true)).toBe(true);
        });
    });

    describe('parseCookies and getCookieValue', () => {
        it('parses standard cookie strings into key-value pairs', () => {
            const header = 'auth_token=jwt123; refresh_token=refresh456; theme=dark';
            const parsed = parseCookies(header);
            expect(parsed.auth_token).toBe('jwt123');
            expect(parsed.refresh_token).toBe('refresh456');
            expect(parsed.theme).toBe('dark');
        });

        it('handles URL-encoded cookie values', () => {
            const header = 'user_data=%7B%22name%22%3A%22Alex%22%7D';
            const parsed = parseCookies(header);
            expect(parsed.user_data).toBe('{"name":"Alex"}');
        });

        it('returns empty object for empty or missing cookie header', () => {
            expect(parseCookies(null)).toEqual({});
            expect(parseCookies(undefined)).toEqual({});
            expect(parseCookies('')).toEqual({});
        });

        it('getCookieValue retrieves specific cookie or null', () => {
            const header = 'csrf_token=csrf-abc-123';
            expect(getCookieValue(header, 'csrf_token')).toBe('csrf-abc-123');
            expect(getCookieValue(header, 'missing')).toBeNull();
        });

        it('getCookieToken retrieves the auth cookie', () => {
            const header = `${AUTH_COOKIE_NAME}=token-xyz-789`;
            expect(getCookieToken(header)).toBe('token-xyz-789');
        });
    });

    describe('getBearerToken', () => {
        it('extracts token from valid Bearer authorization header', () => {
            expect(getBearerToken('Bearer my-jwt-token')).toBe('my-jwt-token');
            expect(getBearerToken('bearer my-jwt-token')).toBe('my-jwt-token');
        });

        it('returns null for non-bearer or empty authorization headers', () => {
            expect(getBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
            expect(getBearerToken('')).toBeNull();
            expect(getBearerToken(null)).toBeNull();
            expect(getBearerToken('Bearer ')).toBeNull();
        });
    });

    describe('getRequestToken', () => {
        it('prioritizes Authorization Bearer header over Cookie', () => {
            const req = {
                headers: {
                    authorization: 'Bearer header-token',
                    cookie: `${AUTH_COOKIE_NAME}=cookie-token`
                }
            };
            expect(getRequestToken(req)).toBe('header-token');
        });

        it('falls back to Cookie when Bearer header is absent', () => {
            const req = {
                headers: {
                    cookie: `${AUTH_COOKIE_NAME}=cookie-token`
                }
            };
            expect(getRequestToken(req)).toBe('cookie-token');
        });

        it('returns null when neither header nor cookie is present', () => {
            expect(getRequestToken(null)).toBeNull();
            expect(getRequestToken({ headers: {} })).toBeNull();
        });
    });

    describe('getSocketToken', () => {
        it('extracts token from socket handshake auth object', () => {
            const socket = {
                handshake: {
                    auth: { token: 'socket-auth-token' }
                }
            };
            expect(getSocketToken(socket)).toBe('socket-auth-token');
        });

        it('falls back to socket handshake cookie header', () => {
            const socket = {
                handshake: {
                    auth: {},
                    headers: {
                        cookie: `${AUTH_COOKIE_NAME}=socket-cookie-token`
                    }
                }
            };
            expect(getSocketToken(socket)).toBe('socket-cookie-token');
        });

        it('returns null if socket or handshake is missing', () => {
            expect(getSocketToken(null)).toBeNull();
            expect(getSocketToken({})).toBeNull();
        });
    });

    describe('signAuthToken and verifyAuthToken', () => {
        const mockUser = {
            id: 42,
            email: 'Test@FullyMee.com',
            username: 'WandererSoul',
            role: 'admin',
            tokenVersion: 1
        };

        it('signs a token with normalized user claims', () => {
            const token = signAuthToken(mockUser);
            expect(typeof token).toBe('string');
            expect(token.split('.')).toHaveLength(3);

            const decoded = verifyAuthToken(token);
            expect(decoded).toBeTruthy();
            expect(decoded.userId).toBe(42);
            expect(decoded.email).toBe('test@fullymee.com');
            expect(decoded.username).toBe('wanderersoul');
            expect(decoded.role).toBe('admin');
            expect(decoded.tokenVersion).toBe(1);
        });

        it('returns user role "user" when role is not admin', () => {
            const normalUser = { id: 10, email: 'user@example.com', role: 'member' };
            const token = signAuthToken(normalUser);
            const decoded = verifyAuthToken(token);
            expect(decoded.role).toBe('user');
        });

        it('returns null when verifying an empty token, and throws for invalid or tampered tokens', () => {
            expect(verifyAuthToken('')).toBeNull();
            expect(verifyAuthToken(null)).toBeNull();
            expect(() => verifyAuthToken('invalid.token.structure')).toThrow();

            const validToken = signAuthToken(mockUser);
            const tamperedToken = validToken.slice(0, -5) + 'xxxxx';
            expect(() => verifyAuthToken(tamperedToken)).toThrow();
        });

        it('throws TokenExpiredError when token is expired', () => {
            const expiredToken = signAuthToken(mockUser, { expiresIn: '-1s' });
            expect(() => verifyAuthToken(expiredToken)).toThrow();
        });
    });

    describe('clearSessionCookies', () => {
        it('clears all auth, refresh, and csrf cookies on response', () => {
            const cleared = [];
            const res = {
                clearCookie: (name, options) => {
                    cleared.push({ name, options });
                },
                cookie: vi.fn()
            };

            clearSessionCookies(res);
            const names = [...new Set(cleared.map((c) => c.name))];
            expect(names).toEqual([
                AUTH_COOKIE_NAME,
                REFRESH_COOKIE_NAME,
                CSRF_COOKIE_NAME
            ]);
            expect(res.cookie).toHaveBeenCalled();
        });
    });
});
