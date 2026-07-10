const { mongoose } = require('../config/db');

const confessionSchema = new mongoose.Schema(
    {
        content: { 
            type: String, 
            required: true, 
            trim: true, 
            minlength: 1, 
            maxlength: 2000 
        },
        author: { 
            type: Number, 
            required: true, 
            ref: 'User', 
            index: true 
        },
        likesCount: { 
            type: Number, 
            default: 0, 
            min: 0, 
            index: true 
        }
    },
    { 
        timestamps: true,
        versionKey: false 
    }
);

// Index for pagination performance
confessionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Confession', confessionSchema);
