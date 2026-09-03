const { mongoose } = require('../config/db');

const messageSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        conversationId: { type: Number, required: true, index: true },
        senderId: { type: Number, required: true, index: true },
        content: { type: String, required: true },
        seq: { type: Number, default: 0, index: true },
        status: { type: String, enum: ['sent', 'delivered', 'read'], default: 'sent', index: true },
        createdAt: { type: Date, default: Date.now },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        expiresAt: { type: Date, default: null },
        clientMessageId: { type: String, trim: true, default: null }
    },
    { versionKey: false }
);

messageSchema.index({ clientMessageId: 1 }, { unique: true, sparse: true });
messageSchema.index({ conversationId: 1, seq: 1 });
messageSchema.index({ conversationId: 1, seq: -1 });
messageSchema.index({ conversationId: 1, id: -1 });
messageSchema.index({ conversationId: 1, id: 1 });
messageSchema.index({ conversationId: 1, id: 1, senderId: 1, status: 1 });
messageSchema.index({ conversationId: 1, status: 1 });
messageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
