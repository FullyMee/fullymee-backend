import { describe, it, expect, vi } from 'vitest';
const request = require('supertest');
const app = require('./app');

// Mock pingDB to avoid real DB connections during health integration test
vi.mock('./config/db', () => ({
    pingDB: vi.fn().mockResolvedValue(true)
}));

describe('Express app root endpoints and security integration', () => {
    describe('GET /health and /api/health', () => {
        it('returns 200 with status ok and uptime on /health', async () => {
            const res = await request(app).get('/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(typeof res.body.uptime).toBe('number');
            expect(typeof res.body.timestamp).toBe('string');
        });

        it('returns 200 on /api/health for monitor pre-warming', async () => {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
        });
    });

    describe('GET /ready', () => {
        it('returns 200 and database check ok when pingDB succeeds', async () => {
            const res = await request(app).get('/ready');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('ok');
            expect(res.body.checks.database).toBe('ok');
        });
    });

    describe('Security headers (Helmet)', () => {
        it('includes nosniff header on responses', async () => {
            const res = await request(app).get('/health');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        it('disables x-powered-by header', async () => {
            const res = await request(app).get('/health');
            expect(res.headers['x-powered-by']).toBeUndefined();
        });
    });

    describe('404 Route handling', () => {
        it('returns 404 with error message for unregistered endpoints', async () => {
            const res = await request(app).get('/api/this-route-does-not-exist');
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: 'Route not found' });
        });
    });
});
