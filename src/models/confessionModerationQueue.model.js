const { mongoose } = require('../config/db');

const confessionModerationQueueSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        roomId: { type: Number, default: null, index: true },
        targetType: { type: String, required: true, enum: ['confession', 'reply', 'room', 'system'], index: true },
        targetId: { type: Number, default: null, index: true },
        userId: { type: Number, default: null, index: true },
        alias: { type: String, default: null, trim: true, maxlength: 40 },
        severity: { type: String, required: true, enum: ['green', 'yellow', 'red'], index: true },
        categories: [{ type: String, trim: true, maxlength: 60 }],
        action: { type: String, required: true, enum: ['allow', 'flag', 'block', 'escalate'] },
        reason: { type: String, default: null, trim: true, maxlength: 300 },
        contentSnapshot: { type: String, default: null, maxlength: 4000 },
        escalationRequired: { type: Boolean, default: false, index: true },
        status: { type: String, enum: ['pending', 'reviewing', 'resolved'], default: 'pending', index: true },
        resolvedByUserId: { type: Number, default: null, index: true },
        resolutionAction: {
            type: String,
            enum: ['approve', 'hide', 'block', 'dismiss'],
            default: null
        },
        resolutionReason: { type: String, default: null, trim: true, maxlength: 500 },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now },
        resolvedAt: { type: Date, default: null }
    },
    { versionKey: false }
);

confessionModerationQueueSchema.index({ status: 1, severity: 1, createdAt: 1 });
confessionModerationQueueSchema.index({ escalationRequired: 1, status: 1, createdAt: 1 });

module.exports = mongoose.model('ConfessionModerationQueue', confessionModerationQueueSchema);
