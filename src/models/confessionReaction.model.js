const { mongoose } = require('../config/db');

const confessionReactionSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        roomId: { type: Number, required: true, index: true },
        targetType: { type: String, required: true, enum: ['confession', 'reply'], index: true },
        targetId: { type: Number, required: true, index: true },
        reactionType: { type: String, required: true, enum: ['support', 'empathy', 'agree', 'insight', 'heart'] },
        userId: { type: Number, required: true, index: true },
        createdAt: { type: Date, default: Date.now, index: true }
    },
    { versionKey: false }
);

confessionReactionSchema.index(
    { roomId: 1, targetType: 1, targetId: 1, userId: 1 },
    { unique: true }
);
confessionReactionSchema.index({ roomId: 1, targetType: 1, targetId: 1, createdAt: -1 });

module.exports = mongoose.model('ConfessionReaction', confessionReactionSchema);
