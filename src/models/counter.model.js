const { mongoose } = require('../config/db');

const counterSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, unique: true },
        seq: { type: Number, default: 0 }
    },
    { versionKey: false }
);

module.exports = mongoose.model('Counter', counterSchema);
