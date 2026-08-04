/**
 * Platform-provided closing notes for Silent Exit.
 * Custom text is intentionally not allowed — these are the only options.
 */

const CLOSING_NOTES = Object.freeze([
    Object.freeze({
        id: 'thank_you',
        emoji: '🌱',
        text: 'Thank you for the conversation.'
    }),
    Object.freeze({
        id: 'natural_end',
        emoji: '🌙',
        text: 'I think this chat has reached its natural end.'
    }),
    Object.freeze({
        id: 'best_wishes',
        emoji: '💙',
        text: 'Wishing you all the best.'
    }),
    Object.freeze({
        id: 'helped_me',
        emoji: '📖',
        text: 'Our conversation helped me. Thank you.'
    }),
    Object.freeze({
        id: 'take_care',
        emoji: '✨',
        text: 'Take care of yourself.'
    })
]);

const DEFAULT_CLOSING_NOTE_TEXT = 'Thank you for being part of it.';

const CLOSING_NOTE_BY_ID = Object.freeze(
    CLOSING_NOTES.reduce((acc, note) => {
        acc[note.id] = note;
        return acc;
    }, {})
);

const RECONNECT_COOLDOWN_DAYS = Number(process.env.CONNECTION_RECONNECT_COOLDOWN_DAYS || 30);
const MAX_RECONNECTS = Number(process.env.CONNECTION_MAX_RECONNECTS || 1);

const END_REASONS = Object.freeze({
    SILENT_EXIT: 'silent_exit',
    REPORT: 'report'
});

const CONVERSATION_STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    PAUSED: 'PAUSED',
    ENDED: 'ENDED'
});

function resolveClosingNote(closingNoteId) {
    if (!closingNoteId) {
        return {
            closingNoteId: null,
            closingNoteText: DEFAULT_CLOSING_NOTE_TEXT,
            closingNoteEmoji: null
        };
    }

    const note = CLOSING_NOTE_BY_ID[String(closingNoteId).trim()];
    if (!note) {
        const err = new Error('Invalid closing note.');
        err.code = 'INVALID_CLOSING_NOTE';
        err.status = 400;
        throw err;
    }

    return {
        closingNoteId: note.id,
        closingNoteText: note.text,
        closingNoteEmoji: note.emoji
    };
}

function getReconnectCooldownMs() {
    const days = Number.isFinite(RECONNECT_COOLDOWN_DAYS) && RECONNECT_COOLDOWN_DAYS > 0
        ? RECONNECT_COOLDOWN_DAYS
        : 30;
    return days * 24 * 60 * 60 * 1000;
}

module.exports = {
    CLOSING_NOTES,
    CLOSING_NOTE_BY_ID,
    DEFAULT_CLOSING_NOTE_TEXT,
    RECONNECT_COOLDOWN_DAYS,
    MAX_RECONNECTS,
    END_REASONS,
    CONVERSATION_STATUS,
    resolveClosingNote,
    getReconnectCooldownMs
};
