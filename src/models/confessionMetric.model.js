const { mongoose } = require('../config/db');

const confessionMetricSchema = new mongoose.Schema(
    {
        roomId: { type: Number, required: true, index: true },
        bucketStart: { type: Date, required: true, index: true },
        joins: { type: Number, default: 0, min: 0 },
        leaves: { type: Number, default: 0, min: 0 },
        confessions: { type: Number, default: 0, min: 0 },
        replies: { type: Number, default: 0, min: 0 },
        reactions: { type: Number, default: 0, min: 0 },
        reports: { type: Number, default: 0, min: 0 },
        flags: { type: Number, default: 0, min: 0 },
        blocks: { type: Number, default: 0, min: 0 },
        totalSessionSeconds: { type: Number, default: 0, min: 0 },
        uniqueActiveUsers: { type: Number, default: 0, min: 0 },
        snapshotActiveUsers: { type: Number, default: 0, min: 0 },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

confessionMetricSchema.index({ roomId: 1, bucketStart: 1 }, { unique: true });
confessionMetricSchema.index({ bucketStart: 1, roomId: 1 });

module.exports = mongoose.model('ConfessionMetric', confessionMetricSchema);
