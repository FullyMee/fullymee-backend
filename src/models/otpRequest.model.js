const { mongoose } = require('../config/db');

const otpRequestSchema = new mongoose.Schema(
    {
        email: { type: String, required: true, unique: true, trim: true, lowercase: true },
        otpHash: { type: String, required: true },
        expiresAt: { type: Date, required: true },
        failedAttempts: { type: Number, default: 0 },
        lockUntil: { type: Date, default: null }
    },
    { versionKey: false }
);

module.exports = mongoose.model('OtpRequest', otpRequestSchema);
