const { mongoose } = require('../config/db');
const { CONVERSATION_STATUS, END_REASONS } = require('../constants/closingNotes');

const participantMetaSchema = new mongoose.Schema(
    {
        userId: { type: Number, required: true },
        isArchived: { type: Boolean, default: false },
        isDeleted: { type: Boolean, default: false },
        archivedAt: { type: Date, default: null },
        deletedAt: { type: Date, default: null },
        lastSeenAt: { type: Date, default: null }
    },
    { _id: false, versionKey: false }
);

const conversationSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        type: { type: String, enum: ['dm', 'group'], default: 'dm' },
        participants: { type: [Number], default: [] },
        participantDisplayNames: { type: Map, of: String, default: {} },
        participantMeta: { type: [participantMetaSchema], default: [] },
        sourceType: { type: String, enum: ['direct', 'chat_request'], default: 'direct' },
        createdAt: { type: Date, default: Date.now },

        // Connection lifecycle (Silent Exit)
        status: {
            type: String,
            enum: Object.values(CONVERSATION_STATUS),
            default: CONVERSATION_STATUS.ACTIVE,
            index: true
        },
        pausedBy: { type: Number, default: null },
        endedAt: { type: Date, default: null },
        // Stored for moderation only — never exposed to the other participant
        endedBy: { type: Number, default: null, select: false },
        endReason: {
            type: String,
            enum: [...Object.values(END_REASONS), null],
            default: null
        },
        closingNoteId: { type: String, trim: true, default: null },
        closingNoteText: { type: String, trim: true, maxlength: 200, default: null },
        reconnectCount: { type: Number, default: 0, min: 0 },
        reconnectAllowedAfter: { type: Date, default: null },
        reconnectBlocked: { type: Boolean, default: false },

        // Legacy flags kept for older clients / indexes
        isArchived: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null }
    },
    { versionKey: false }
);

conversationSchema.index({ participants: 1, status: 1, id: -1 });
conversationSchema.index({ participants: 1, isArchived: 1, deletedAt: 1, id: -1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ type: 1, participants: 1, status: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
