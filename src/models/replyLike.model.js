const { mongoose } = require('../config/db');

const replyLikeSchema = new mongoose.Schema(
    {
        replyId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'ConfessionReply', 
            required: true, 
            index: true 
        },
        userId: { 
            type: Number, 
            required: true, 
            index: true 
        },
        createdAt: { 
            type: Date, 
            default: Date.now 
        }
    },
    { 
        versionKey: false 
    }
);

// Prevent duplicate likes using a compound unique index: (replyId, userId)
replyLikeSchema.index({ replyId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ReplyLike', replyLikeSchema);
