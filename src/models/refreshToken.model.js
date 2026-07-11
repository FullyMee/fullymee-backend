const { mongoose } = require('../config/db');

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: Number, required: true, index: true },
    tokenVersionAtIssue: { type: Number, required: true, default: 0 },
    createdByIp: { type: String, trim: true, default: null },
    userAgent: { type: String, trim: true, default: null },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    reuseDetectedAt: { type: Date, default: null }
  },
  { versionKey: false }
);

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
