const { mongoose } = require('../config/db');

const confessionRoomMemberSchema = new mongoose.Schema(
    {
        roomId: { type: Number, required: true, index: true },
        userId: { type: Number, required: true, index: true },
        alias: { type: String, required: true, trim: true, maxlength: 40 },
        isActive: { type: Boolean, default: true, index: true },
        joinedAt: { type: Date, default: Date.now },
        lastActiveAt: { type: Date, default: Date.now },
        leftAt: { type: Date, default: null },
        joinSource: { type: String, default: 'algorithm', trim: true, maxlength: 40 },
        shuffleCount: { type: Number, default: 0 },
        lastShuffledAt: { type: Date, default: null }
    },
    { versionKey: false }
);

confessionRoomMemberSchema.index({ roomId: 1, userId: 1 }, { unique: true });
confessionRoomMemberSchema.index({ roomId: 1, alias: 1 }, { unique: true });
confessionRoomMemberSchema.index({ userId: 1, isActive: 1, lastActiveAt: -1 });
confessionRoomMemberSchema.index({ roomId: 1, isActive: 1, joinedAt: -1 });
confessionRoomMemberSchema.index({ isActive: 1, lastActiveAt: 1, roomId: 1 });

module.exports = mongoose.model('ConfessionRoomMember', confessionRoomMemberSchema);
