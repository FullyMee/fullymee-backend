const { mongoose } = require('../config/db');

const confessionLikeSchema = new mongoose.Schema(
    {
        confessionId: { 
            type: mongoose.Schema.Types.ObjectId, 
            ref: 'ConfessionPost', 
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

// Prevent duplicate likes using a compound unique index: (confessionId, userId)
confessionLikeSchema.index({ confessionId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('ConfessionLike', confessionLikeSchema);
