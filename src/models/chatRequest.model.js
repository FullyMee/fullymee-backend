const { mongoose } = require('../config/db');

const chatRequestSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        requesterUserId: { type: Number, required: true, index: true },
        targetUserId: { type: Number, required: true, index: true },
        requesterAlias: { type: String, required: true, trim: true, maxlength: 40 },
        targetAlias: { type: String, required: true, trim: true, maxlength: 40 },
        roomId: { type: Number, default: null, index: true },
        confessionId: { type: Number, default: null, index: true },
        contextType: { type: String, enum: ['confession', 'reply', 'profile'], default: 'confession' },
        contextPreview: { type: String, default: '', trim: true, maxlength: 280 },
        status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending', index: true },
        conversationId: { type: Number, default: null, index: true },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now },
        respondedAt: { type: Date, default: null }
    },
    { versionKey: false }
);

chatRequestSchema.index({ targetUserId: 1, status: 1, createdAt: -1 });
chatRequestSchema.index({ requesterUserId: 1, status: 1, createdAt: -1 });
chatRequestSchema.index({ requesterUserId: 1, targetUserId: 1, confessionId: 1, status: 1 });

module.exports = mongoose.model('ChatRequest', chatRequestSchema);
