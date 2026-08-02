const { mongoose } = require('../config/db');

const preferencesSchema = new mongoose.Schema(
    {
        // Identity
        avatar: { type: String, trim: true, maxlength: 10, default: '🌊' },

        // Chat Controls
        chatRequestPermission: {
            type: String,
            enum: ['everyone', 'nobody'],
            default: 'everyone'
        },
        limitNighttimeRequests: { type: Boolean, default: false },

        // Privacy & Safety
        hideJoinedRooms: { type: Boolean, default: false },
        hideProfileGlobal: { type: Boolean, default: false },
        audioExpiry: {
            type: String,
            enum: ['never', '24h', '7d', '30d'],
            default: 'never'
        }
    },
    { _id: false, versionKey: false }
);

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
        googleSub: { type: String, trim: true, unique: true, sparse: true, index: true },
        authProviders: {
            type: [String],
            enum: ['email', 'google'],
            default: []
        },
        role: {
            type: String,
            enum: ['user', 'admin'],
            default: 'user',
            index: true
        },
        tokenVersion: { type: Number, default: 0, index: true },
        preferences: { type: preferencesSchema, default: () => ({}) },
        createdAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

module.exports = mongoose.model('User', userSchema);
