import { describe, it, expect, vi } from 'vitest';
const verifyCsrfToken = require('./csrf.middleware');

describe('csrf.middleware', () => {
    function createMockRes() {
        const res = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    }

    it('allows safe HTTP methods (GET, HEAD, OPTIONS) without checking CSRF token', () => {
        const next = vi.fn();
        const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

        for (const method of safeMethods) {
            const req = { method, path: '/api/conversations', headers: {} };
            const res = createMockRes();
            verifyCsrfToken(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            next.mockClear();
        }
    });

    it('allows public auth paths without checking CSRF token', () => {
        const next = vi.fn();
        const publicPaths = [
            '/api/auth/request-otp',
            '/api/auth/verify-otp',
            '/api/auth/google-signin'
        ];

        for (const path of publicPaths) {
            const req = { method: 'POST', path, headers: {} };
            const res = createMockRes();
            verifyCsrfToken(req, res, next);
            expect(next).toHaveBeenCalled();
            next.mockClear();
        }
    });

    it('rejects POST request when CSRF token is missing with 403', () => {
        const next = vi.fn();
        const req = {
            method: 'POST',
            path: '/api/conversations',
            headers: {}
        };
        const res = createMockRes();

        verifyCsrfToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('rejects POST request when header token does not match cookie token with 403', () => {
        const next = vi.fn();
        const req = {
            method: 'POST',
            path: '/api/conversations',
            headers: {
                'x-csrf-token': 'token-abc',
                cookie: 'csrf_token=token-xyz'
            }
        };
        const res = createMockRes();

        verifyCsrfToken(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
        expect(next).not.toHaveBeenCalled();
    });

    it('calls next() when header token matches cookie token', () => {
        const next = vi.fn();
        const req = {
            method: 'POST',
            path: '/api/conversations',
            headers: {
                'x-csrf-token': 'valid-csrf-token-123',
                cookie: 'csrf_token=valid-csrf-token-123'
            }
        };
        const res = createMockRes();

        verifyCsrfToken(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
