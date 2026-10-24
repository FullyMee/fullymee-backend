import { describe, it, expect, vi, beforeEach } from 'vitest';
const User = require('../models/user.model');
const { requireModerationAdmin } = require('./admin.middleware');

describe('admin.middleware', () => {
    function createMockRes() {
        const res = {};
        res.status = vi.fn().mockReturnValue(res);
        res.json = vi.fn().mockReturnValue(res);
        return res;
    }

    beforeEach(() => {
        vi.restoreAllMocks();
        process.env.ADMIN_USER_IDS = '100, 200';
    });

    it('returns 401 when req.user or userId is missing or invalid', async () => {
        const next = vi.fn();
        const res = createMockRes();

        await requireModerationAdmin({}, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(next).not.toHaveBeenCalled();

        const res2 = createMockRes();
        await requireModerationAdmin({ user: { userId: 0 } }, res2, next);
        expect(res2.status).toHaveBeenCalledWith(401);
    });

    it('calls next() immediately if userId is in configured ADMIN_USER_IDS', async () => {
        const next = vi.fn();
        const res = createMockRes();
        const req = { user: { userId: 100 } };

        await requireModerationAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('checks database when userId is not in env config, calls next() if role is admin', async () => {
        const next = vi.fn();
        const res = createMockRes();
        const req = { user: { userId: 350 } };

        vi.spyOn(User, 'findOne').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ role: 'admin' })
            })
        });

        await requireModerationAdmin(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 403 when user exists in DB but role is not admin', async () => {
        const next = vi.fn();
        const res = createMockRes();
        const req = { user: { userId: 350 } };

        vi.spyOn(User, 'findOne').mockReturnValue({
            select: vi.fn().mockReturnValue({
                lean: vi.fn().mockResolvedValue({ role: 'user' })
            })
        });

        await requireModerationAdmin(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
        expect(next).not.toHaveBeenCalled();
    });
});
