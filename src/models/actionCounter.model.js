const { mongoose } = require('../config/db');

const actionCounterSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, index: true },
        count: { type: Number, required: true, default: 0, min: 0 },
        expiresAt: { type: Date, required: true, index: true }
    },
    { versionKey: false }
);

actionCounterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'action_counter_ttl' });

module.exports = mongoose.model('ActionCounter', actionCounterSchema);
