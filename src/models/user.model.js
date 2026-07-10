const { mongoose } = require('../config/db');

const userSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        username: {
            type: String,
            trim: true,
            lowercase: true,
            unique: true,
            sparse: true,
            index: true
        },
        interests: [{ type: String, trim: true, lowercase: true }],
        email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user',
            index: true
        },
            tokenVersion: { type: Number, default: 0, index: true },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model('User', userSchema);
