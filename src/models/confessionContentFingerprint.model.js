const { mongoose } = require('../config/db');

const confessionContentFingerprintSchema = new mongoose.Schema(
    {
        userId: { type: Number, required: true, index: true },
        roomId: { type: Number, required: true, index: true },
        type: { type: String, required: true, enum: ['confession', 'reply'], index: true },
        hash: { type: String, required: true, trim: true, index: true },
        count: { type: Number, required: true, default: 1, min: 1 },
        firstSeenAt: { type: Date, default: Date.now },
        lastSeenAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true, index: true }
    },
    { versionKey: false }
);

confessionContentFingerprintSchema.index(
    { userId: 1, roomId: 1, type: 1, hash: 1 },
    { unique: true }
);
confessionContentFingerprintSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'confession_fingerprint_ttl' });

module.exports = mongoose.model('ConfessionContentFingerprint', confessionContentFingerprintSchema);
