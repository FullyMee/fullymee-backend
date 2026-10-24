import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const {
    getMessageTtlMinutes,
    getMessageExpiryMs,
    getMessageExpiresAt
} = require('./messageExpiry');

describe('messageExpiry utilities', () => {
    const originalEnv = process.env.MESSAGE_TTL_MIN;

    beforeEach(() => {
        delete process.env.MESSAGE_TTL_MIN;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.MESSAGE_TTL_MIN = originalEnv;
        } else {
            delete process.env.MESSAGE_TTL_MIN;
        }
    });

    it('defaults TTL to 5 minutes when env var is not provided or invalid', () => {
        expect(getMessageTtlMinutes()).toBe(5);

        process.env.MESSAGE_TTL_MIN = '-1';
        expect(getMessageTtlMinutes()).toBe(5);

        process.env.MESSAGE_TTL_MIN = 'invalid';
        expect(getMessageTtlMinutes()).toBe(5);
    });

    it('parses valid numeric MESSAGE_TTL_MIN', () => {
        process.env.MESSAGE_TTL_MIN = '15';
        expect(getMessageTtlMinutes()).toBe(15);
    });

    it('converts TTL minutes into milliseconds accurately', () => {
        process.env.MESSAGE_TTL_MIN = '10';
        expect(getMessageExpiryMs()).toBe(10 * 60 * 1000);
    });

    it('calculates getMessageExpiresAt timestamp in the future', () => {
        const NOW = 1700000000000;
        vi.useFakeTimers();
        vi.setSystemTime(NOW);

        process.env.MESSAGE_TTL_MIN = '5';
        const expiresAt = getMessageExpiresAt();
        expect(expiresAt.getTime()).toBe(NOW + 5 * 60 * 1000);

        vi.useRealTimers();
    });
});
