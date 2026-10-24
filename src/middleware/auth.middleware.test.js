import { describe, it, expect, vi, beforeEach } from 'vitest';
const User = require('../models/user.model');
const { signAuthToken } = require('../utils/authToken');
const { authenticate } = require('./auth.middleware');

vi.mock('../metrics/prometheus', () => ({
    recordAuthTokenVersionMismatch: vi.fn()
}));

describe('auth.middleware', () => {
    function createMockRes() {
        const res = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    }

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 401 when no token is provided in headers or cookies', async () => {
        const next = vi.fn();
        const res = createMockRes();
        const req = { headers: {} };

        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'No token provided' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is invalid or corrupted', async () => {
        const next = vi.fn();
        const res = createMockRes();
        const req = { headers: { authorization: 'Bearer invalid.corrupted.token' } };

        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when user is not found in database', async () => {
        const token = signAuthToken({ id: 55, tokenVersion: 0 });
        const next = vi.fn();
        const res = createMockRes();
        const req = { headers: { authorization: `Bearer ${token}` } };

        vi.spyOn(User, 'findOne').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue(null)
            })
        });

        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 "Token revoked" when tokenVersion does not match DB', async () => {
        const token = signAuthToken({ id: 55, tokenVersion: 1 });
        const next = vi.fn();
        const res = createMockRes();
        const req = { headers: { authorization: `Bearer ${token}` } };

        vi.spyOn(User, 'findOne').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ id: 55, tokenVersion: 2 })
            })
        });

        await authenticate(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Token revoked' });
        expect(next).not.toHaveBeenCalled();
    });

    it('hydrates req.user and calls next() when token and tokenVersion are valid', async () => {
        const token = signAuthToken({ id: 55, tokenVersion: 1, role: 'user' });
        const next = vi.fn();
        const res = createMockRes();
        const req = { headers: { authorization: `Bearer ${token}` } };

        vi.spyOn(User, 'findOne').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ id: 55, tokenVersion: 1 })
            })
        });

        await authenticate(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.userId).toBe(55);
        expect(res.status).not.toHaveBeenCalled();
    });
});
