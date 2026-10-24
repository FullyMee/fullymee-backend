import { describe, it, expect } from 'vitest';
const {
    CLOSING_NOTES,
    CLOSING_NOTE_BY_ID,
    DEFAULT_CLOSING_NOTE_TEXT,
    resolveClosingNote,
    getReconnectCooldownMs
} = require('./closingNotes');

describe('closingNotes constants and helpers', () => {
    it('defines 5 immutable closing notes with valid fields', () => {
        expect(Array.isArray(CLOSING_NOTES)).toBe(true);
        expect(CLOSING_NOTES).toHaveLength(5);

        for (const note of CLOSING_NOTES) {
            expect(note.id).toBeTruthy();
            expect(note.emoji).toBeTruthy();
            expect(note.text).toBeTruthy();
            expect(Object.isFrozen(note)).toBe(true);
        }
    });

    it('indexes notes by ID correctly in CLOSING_NOTE_BY_ID', () => {
        expect(CLOSING_NOTE_BY_ID['thank_you']).toBeDefined();
        expect(CLOSING_NOTE_BY_ID['thank_you'].emoji).toBe('🌱');
        expect(CLOSING_NOTE_BY_ID['natural_end']).toBeDefined();
    });

    describe('resolveClosingNote', () => {
        it('returns default note text when closingNoteId is null, undefined, or empty', () => {
            const resNull = resolveClosingNote(null);
            expect(resNull.closingNoteId).toBeNull();
            expect(resNull.closingNoteText).toBe(DEFAULT_CLOSING_NOTE_TEXT);

            const resEmpty = resolveClosingNote('');
            expect(resEmpty.closingNoteText).toBe(DEFAULT_CLOSING_NOTE_TEXT);
        });

        it('resolves valid closing note by ID', () => {
            const res = resolveClosingNote('thank_you');
            expect(res.closingNoteId).toBe('thank_you');
            expect(res.closingNoteText).toBe('Thank you for the conversation.');
            expect(res.closingNoteEmoji).toBe('🌱');
        });

        it('throws 400 error for unknown closing note IDs', () => {
            expect(() => resolveClosingNote('custom_note_hack')).toThrow('Invalid closing note.');
            try {
                resolveClosingNote('unknown');
            } catch (err) {
                expect(err.code).toBe('INVALID_CLOSING_NOTE');
                expect(err.status).toBe(400);
            }
        });
    });

    describe('getReconnectCooldownMs', () => {
        it('returns duration in milliseconds (at least 30 days default)', () => {
            const ms = getReconnectCooldownMs();
            expect(ms).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000);
        });
    });
});
