const { mongoose } = require('../config/db');

const confessionReportSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        roomId: { type: Number, required: true, index: true },
        targetType: { type: String, required: true, enum: ['confession', 'reply'], index: true },
        targetId: { type: Number, required: true, index: true },
        reporterUserId: { type: Number, required: true, index: true },
        reason: { type: String, required: true, trim: true, minlength: 3, maxlength: 280 },
        status: { type: String, enum: ['open', 'reviewed', 'dismissed', 'actioned'], default: 'open', index: true },
        createdAt: { type: Date, default: Date.now, index: true },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

confessionReportSchema.index(
    { targetType: 1, targetId: 1, reporterUserId: 1 },
    { unique: true }
);
confessionReportSchema.index({ status: 1, createdAt: -1 });
confessionReportSchema.index({ roomId: 1, createdAt: -1 });

module.exports = mongoose.model('ConfessionReport', confessionReportSchema);
