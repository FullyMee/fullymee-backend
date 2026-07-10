const { mongoose } = require('../config/db');

const confessionReplySchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        shardKey: { type: String, required: true, index: true },
        roomId: { type: Number, required: true, index: true },
        confessionId: { type: Number, required: true, index: true },
        alias: { type: String, required: true, trim: true, maxlength: 40 },
        content: { type: String, required: true, trim: true, minlength: 1, maxlength: 1500 },
        contentHash: { type: String, required: true, trim: true, index: true },
        author: { type: Number, ref: 'User', index: true },
        likesCount: { type: Number, default: 0, min: 0, index: true },
        reactionCount: { type: Number, default: 0, min: 0 },
        positiveReactionCount: { type: Number, default: 0, min: 0 },
        reportCount: { type: Number, default: 0, min: 0 },
        moderationStatus: { type: String, enum: ['approved', 'flagged', 'blocked'], default: 'approved', index: true },
        moderationSeverity: { type: String, enum: ['green', 'yellow', 'red'], default: 'green' },
        moderationReasons: [{ type: String, trim: true, maxlength: 120 }],
        sentimentScore: { type: Number, default: 0 },
        rankingScore: { type: Number, default: 0 },
        isHidden: { type: Boolean, default: false, index: true },
        hiddenReason: { type: String, default: null, trim: true, maxlength: 200 },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now },
        lastEngagementAt: { type: Date, default: Date.now, index: true }
    },
    { versionKey: false }
);

confessionReplySchema.index({ confessionId: 1, isHidden: 1, moderationStatus: 1, rankingScore: -1, createdAt: -1 });
confessionReplySchema.index({ roomId: 1, confessionId: 1, createdAt: -1 });
confessionReplySchema.index({ roomId: 1, contentHash: 1, createdAt: -1 });

module.exports = mongoose.model('ConfessionReply', confessionReplySchema);
