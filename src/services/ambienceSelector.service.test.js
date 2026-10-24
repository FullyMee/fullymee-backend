import { describe, it, expect } from 'vitest';
const { normalizeCategoryKey } = require('./ambienceSelector.service');

describe('ambienceSelector.service', () => {
    describe('normalizeCategoryKey', () => {
        it('defaults to "late_night" when input is null, undefined, or empty', () => {
            expect(normalizeCategoryKey(null)).toBe('late_night');
            expect(normalizeCategoryKey(undefined)).toBe('late_night');
            expect(normalizeCategoryKey('')).toBe('late_night');
        });

        it('normalizes category aliases to canonical keys', () => {
            expect(normalizeCategoryKey('latenight')).toBe('late_night');
            expect(normalizeCategoryKey('late_night')).toBe('late_night');
            expect(normalizeCategoryKey('Late Night')).toBe('late_night');
            expect(normalizeCategoryKey('tech_and_coding')).toBe('tech_coding');
            expect(normalizeCategoryKey('casual_chats')).toBe('casual_chat');
            expect(normalizeCategoryKey('relationship')).toBe('relationships');
            expect(normalizeCategoryKey('startup')).toBe('startups');
        });

        it('cleans special characters and lowercases custom categories', () => {
            expect(normalizeCategoryKey('Deep Thoughts & Life!')).toBe('deep_thoughts__life');
            expect(normalizeCategoryKey('CAREER')).toBe('career');
        });
    });
});
