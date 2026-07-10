const { mongoose } = require('../config/db');

const conversationReadSchema = new mongoose.Schema(
    {
        conversationId: { type: Number, required: true, index: true },
        userId: { type: Number, required: true, index: true },
        lastReadMessageId: { type: Number, default: null },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

conversationReadSchema.index({ conversationId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ConversationRead', conversationReadSchema);
