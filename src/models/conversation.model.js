const { mongoose } = require('../config/db');

const conversationSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        type: { type: String, enum: ['dm', 'group'], default: 'dm' },
        participants: { type: [Number], default: [] },
        participantDisplayNames: { type: Map, of: String, default: {} },
        sourceType: { type: String, enum: ['direct', 'chat_request'], default: 'direct' },
        createdAt: { type: Date, default: Date.now },
        isArchived: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null }
    },
    { versionKey: false }
);

conversationSchema.index({ participants: 1, isArchived: 1, deletedAt: 1, id: -1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ type: 1, participants: 1 });

module.exports = mongoose.model('Conversation', conversationSchema);
