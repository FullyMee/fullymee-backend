import { describe, it, expect, beforeEach } from 'vitest';
const { getConfiguredAdminIdSet, isConfiguredAdminUser } = require('./adminAccess');

describe('adminAccess utilities', () => {
    const originalEnv = process.env.ADMIN_USER_IDS;

    beforeEach(() => {
        process.env.ADMIN_USER_IDS = '10, 20, 30';
    });

    it('parses comma-separated integer admin IDs into a Set', () => {
        const adminSet = getConfiguredAdminIdSet();
        expect(adminSet.has(10)).toBe(true);
        expect(adminSet.has(20)).toBe(true);
        expect(adminSet.has(30)).toBe(true);
        expect(adminSet.has(999)).toBe(false);
    });

    it('identifies configured admin users accurately', () => {
        expect(isConfiguredAdminUser(10)).toBe(true);
        expect(isConfiguredAdminUser('20')).toBe(true);
        expect(isConfiguredAdminUser(30)).toBe(true);
    });

    it('rejects non-admin, non-integer, or falsy user IDs', () => {
        expect(isConfiguredAdminUser(99)).toBe(false);
        expect(isConfiguredAdminUser(0)).toBe(false);
        expect(isConfiguredAdminUser(-5)).toBe(false);
        expect(isConfiguredAdminUser(null)).toBe(false);
        expect(isConfiguredAdminUser(undefined)).toBe(false);
        expect(isConfiguredAdminUser('abc')).toBe(false);
    });

    it('handles empty or missing ADMIN_USER_IDS gracefully', () => {
        process.env.ADMIN_USER_IDS = '';
        expect(isConfiguredAdminUser(10)).toBe(false);
    });
});
