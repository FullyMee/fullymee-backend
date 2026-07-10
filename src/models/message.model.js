const { mongoose } = require('../config/db');

const messageSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        conversationId: { type: Number, required: true, index: true },
        senderId: { type: Number, required: true, index: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
        clientMessageId: { type: String, trim: true, default: null }
    },
    { versionKey: false }
);

messageSchema.index({ clientMessageId: 1 }, { unique: true, sparse: true });
messageSchema.index({ conversationId: 1, id: -1 });
messageSchema.index({ conversationId: 1, expiresAt: 1, id: -1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });

module.exports = mongoose.model('Message', messageSchema);
