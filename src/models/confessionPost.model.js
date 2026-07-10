const { mongoose } = require('../config/db');

const confessionPostSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        shardKey: { type: String, required: true, index: true },
        roomId: { type: Number, required: true, index: true },
        alias: { type: String, required: true, trim: true, maxlength: 40 },
        content: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
        contentHash: { type: String, required: true, trim: true, index: true },
        author: { type: Number, ref: 'User', index: true },
        likesCount: { type: Number, default: 0, min: 0, index: true },
        reactionCount: { type: Number, default: 0, min: 0 },
        positiveReactionCount: { type: Number, default: 0, min: 0 },
        replyCount: { type: Number, default: 0, min: 0 },
        reportCount: { type: Number, default: 0, min: 0 },
        moderationStatus: { type: String, enum: ['approved', 'flagged', 'blocked'], default: 'approved', index: true },
        moderationSeverity: { type: String, enum: ['green', 'yellow', 'red'], default: 'green' },
        moderationReasons: [{ type: String, trim: true, maxlength: 120 }],
        sentimentScore: { type: Number, default: 0 },
        rankingScore: { type: Number, default: 0 },
        isHidden: { type: Boolean, default: false, index: true },
        hiddenReason: { type: String, default: null, trim: true, maxlength: 200 },
        isPublished: { type: Boolean, default: true, index: true },
        scheduleStatus: { type: String, enum: ['pending', 'confirming', 'cancelled'], default: null, index: true },
        scheduledAt: { type: Date, default: null },
        publishedAt: { type: Date, default: null },
        confirmExpiresAt: { type: Date, default: null },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now },
        lastEngagementAt: { type: Date, default: Date.now, index: true }
    },
    { versionKey: false }
);

confessionPostSchema.index({ roomId: 1, isHidden: 1, moderationStatus: 1, rankingScore: -1, createdAt: -1 });
confessionPostSchema.index({ roomId: 1, isHidden: 1, createdAt: -1 });
confessionPostSchema.index({ roomId: 1, reportCount: -1 });
confessionPostSchema.index({ roomId: 1, contentHash: 1, createdAt: -1 });
confessionPostSchema.index({ scheduleStatus: 1, scheduledAt: 1 });
confessionPostSchema.index({ scheduleStatus: 1, confirmExpiresAt: 1 });
confessionPostSchema.index({ author: 1, isPublished: 1, scheduleStatus: 1 });

module.exports = mongoose.model('ConfessionPost', confessionPostSchema);
