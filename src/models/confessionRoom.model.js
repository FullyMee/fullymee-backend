const { mongoose } = require('../config/db');

const confessionRoomSchema = new mongoose.Schema(
    {
        id: { type: Number, required: true, unique: true, index: true },
        shardKey: { type: String, required: true, index: true },
        title: { type: String, required: true, trim: true, maxlength: 120 },
        description: { type: String, default: '', trim: true, maxlength: 500 },
        category: { type: String, required: true, trim: true, lowercase: true, index: true },
        ambienceId: { type: String, default: null, trim: true },
        tags: [{ type: String, trim: true, lowercase: true }],
        roomFamilyKey: { type: String, required: true, trim: true, lowercase: true, index: true },
        roomInstance: { type: Number, required: true, default: 1 },
        maxCapacity: { type: Number, required: true, default: 50, min: 2, max: 500 },
        currentUserCount: { type: Number, required: true, default: 0, min: 0 },
        roomType: { type: String, enum: ['public', 'private', 'timed'], default: 'public', index: true },
        joinCode: { type: String, default: null, trim: true, minlength: 6, maxlength: 6 },
        createdByUserId: { type: Number, default: null, index: true },
        isActive: { type: Boolean, default: true, index: true },
        expiresAt: { type: Date, default: null, index: true },
        engagementRate: { type: Number, default: 0 },
        averageSessionSec: { type: Number, default: 0 },
        timeWeightMorning: { type: Number, default: 1 },
        timeWeightAfternoon: { type: Number, default: 1 },
        timeWeightEvening: { type: Number, default: 1 },
        timeWeightNight: { type: Number, default: 1 },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now }
    },
    { versionKey: false }
);

confessionRoomSchema.index({ roomFamilyKey: 1, roomInstance: 1 }, { unique: true });
confessionRoomSchema.index({ category: 1, isActive: 1, roomType: 1, currentUserCount: 1 });
confessionRoomSchema.index({ roomFamilyKey: 1, isActive: 1, createdAt: -1 });
confessionRoomSchema.index({ shardKey: 1, id: 1 });
confessionRoomSchema.index({ roomType: 1, isActive: 1, expiresAt: 1, id: 1 });
confessionRoomSchema.index({ isActive: 1, roomType: 1, category: 1, createdAt: -1 });
confessionRoomSchema.index(
    { joinCode: 1 },
    {
        unique: true,
        partialFilterExpression: {
            joinCode: { $type: 'string' }
        }
    }
);

module.exports = mongoose.model('ConfessionRoom', confessionRoomSchema);
