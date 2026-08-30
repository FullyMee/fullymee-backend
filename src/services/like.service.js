const crypto = require('crypto');
const EventEmitter = require('events');
const { mongoose } = require('../config/db');
const ConfessionPost = require('../models/confessionPost.model');
const ConfessionLike = require('../models/confessionLike.model');
const ConfessionReply = require('../models/confessionReply.model');
const ReplyLike = require('../models/replyLike.model');
const { getNextSequence } = require('../utils/sequence');

const likeEmitter = new EventEmitter();

/**
 * Atomically toggle like/unlike using MongoDB Transactions and Mongoose Sessions.
 * Automatically falls back to non-transactional atomic operations if standalone MongoDB is used.
 */
async function toggleLikeConfession({ confessionId, userId }) {
    const uId = Number(userId);
    if (!uId) {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
    }

    let result = null;
    let transactionSupported = true;
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            result = await performLikeToggle(confessionId, uId, session);
        });
    } catch (error) {
        const errMsg = error.message || '';
        // Detect if transactions are not supported by the environment (e.g. standalone MongoDB)
        if (
            errMsg.includes('Transaction numbers are only allowed on a replica set member') ||
            errMsg.includes('sessions are not supported') ||
            error.codeName === 'IllegalOperation' ||
            error.code === 20
        ) {
            transactionSupported = false;
        } else {
            throw error;
        }
    } finally {
        session.endSession();
    }

    // Fallback if environment doesn't support replica set transactions
    if (!transactionSupported) {
        console.warn('MongoDB transactions not supported. Falling back to non-transactional atomic operation.');
        result = await performLikeToggle(confessionId, uId, null);
    }

    // Emit realtime Socket.io update through the event emitter (using numeric ID for room client compatibility)
    if (result) {
        likeEmitter.emit('confession:likesUpdated', {
            confessionId: Number(result.confessionId),
            likesCount: result.likesCount
        });
    }

    return result;
}

/**
 * Internal logic for toggling like/unlike.
 */
async function performLikeToggle(confessionId, userId, session) {
    const opt = session ? { session } : {};

    // 1. Ensure the confession exists (support lookup by ObjectId or by numeric id)
    let query = {};
    if (mongoose.Types.ObjectId.isValid(confessionId)) {
        query = { _id: confessionId };
    } else if (Number.isInteger(Number(confessionId))) {
        query = { id: Number(confessionId) };
    } else {
        const err = new Error('Invalid confession ID format');
        err.status = 400;
        throw err;
    }

    const confession = await ConfessionPost.findOne(query).session(session);
    if (!confession) {
        const err = new Error('Confession not found');
        err.status = 404;
        throw err;
    }

    const confessionRefId = confession._id;

    // 2. Check if the user has already liked this confession
    const existingLike = await ConfessionLike.findOne({ confessionId: confessionRefId, userId }).session(session);

    if (existingLike) {
        // Unlike toggle: Remove like document
        await ConfessionLike.deleteOne({ _id: existingLike._id }, opt);

        // Decrement likesCount & reactionCount ensuring they do not drop below 0
        const updatedConfession = await ConfessionPost.findOneAndUpdate(
            { _id: confessionRefId, likesCount: { $gt: 0 } },
            { $inc: { likesCount: -1, reactionCount: -1 } },
            { new: true, ...opt }
        );

        const likesCount = updatedConfession ? updatedConfession.likesCount : 0;

        return {
            confessionId: confession.id,
            likesCount,
            liked: false
        };
    } else {
        // Like toggle: Create like document
        try {
            await ConfessionLike.create([{ confessionId: confessionRefId, userId }], opt);
        } catch (err) {
            // Handle compound unique index key violation (concurrency race condition)
            if (err.code === 11000) {
                const current = await ConfessionPost.findOne({ _id: confessionRefId }).session(session);
                return {
                    confessionId: confession.id,
                    likesCount: current ? current.likesCount : 0,
                    liked: true
                };
            }
            throw err;
        }

        // Increment likesCount & reactionCount
        const updatedConfession = await ConfessionPost.findOneAndUpdate(
            { _id: confessionRefId },
            { $inc: { likesCount: 1, reactionCount: 1 } },
            { new: true, ...opt }
        );

        const likesCount = updatedConfession ? updatedConfession.likesCount : 1;

        return {
            confessionId: confession.id,
            likesCount,
            liked: true
        };
    }
}

/**
 * High-performance list feed query (Two-Query Approach).
 * Minimizes MongoDB queries and writes, avoids N+1 queries.
 */
async function listFeed({ userId, limit = 20, offset = 0 }) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 20));
    const off = Math.max(0, Number(offset) || 0);

    // Query 1: Fetch confessions directly reading likesCount (no COUNT query)
    const confessions = await ConfessionPost.find({})
        .sort({ createdAt: -1 })
        .skip(off)
        .limit(lim)
        .lean();

    if (!confessions.length) {
        return [];
    }

    // Query 2: Fetch which confessions the current user has liked to avoid N+1 query
    const currentUserId = Number(userId);
    let likedSet = new Set();
    
    if (currentUserId) {
        const confessionIds = confessions.map(c => c._id);
        const userLikes = await ConfessionLike.find({
            confessionId: { $in: confessionIds },
            userId: currentUserId
        })
            .select('confessionId')
            .lean();

        likedSet = new Set(userLikes.map(like => like.confessionId.toString()));
    }

    const authorIds = [...new Set(confessions.map(c => c.author).filter(Boolean))];
    const User = require('../models/user.model');
    const users = await User.find({ id: { $in: authorIds } }).select({ id: 1, 'preferences.avatar': 1 }).lean();
    const avatarMap = new Map(users.map(u => [u.id, u.preferences?.avatar || null]));

    return confessions.map(c => ({
        _id: c._id,
        id: c.id,
        content: c.content,
        authorAvatar: avatarMap.get(c.author) || null,
        likesCount: c.likesCount || 0,
        reactionCount: c.likesCount || c.reactionCount || 0,
        likedByCurrentUser: likedSet.has(c._id.toString()),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
    }));
}

/**
 * Alternative approach: Aggregation pipeline to retrieve the feed.
 */
async function listFeedAggregation({ userId, limit = 20, offset = 0 }) {
    const lim = Math.max(1, Math.min(100, Number(limit) || 20));
    const off = Math.max(0, Number(offset) || 0);
    const currentUserId = Number(userId) || null;

    return ConfessionPost.aggregate([
        { $sort: { createdAt: -1 } },
        { $skip: off },
        { $limit: lim },
        {
            $lookup: {
                from: 'confessionlikes', // collection name
                let: { confessionId: '$$id' }, // lookup using ObjectId
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ['$confessionId', '$$confessionId'] },
                                    { $eq: ['$userId', currentUserId] }
                                ]
                            }
                        }
                    },
                    { $limit: 1 }
                ],
                as: 'userLikes'
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: 'author',
                foreignField: 'id',
                as: 'authorDoc'
            }
        },
        {
            $unwind: {
                path: '$authorDoc',
                preserveNullAndEmptyArrays: true
            }
        },
        {
            $project: {
                _id: 1,
                id: 1,
                content: 1,
                authorAvatar: '$authorDoc.preferences.avatar',
                likesCount: 1,
                reactionCount: '$likesCount',
                createdAt: 1,
                updatedAt: 1,
                likedByCurrentUser: { $gt: [{ $size: '$userLikes' }, 0] }
            }
        }
    ]);
}

/**
 * Helper to create a new confession.
 */
async function createConfession({ content, userId }) {
    const text = String(content || '').trim();
    if (!text) {
        const err = new Error('Content is required');
        err.status = 400;
        throw err;
    }

    const confessionId = await getNextSequence('confession_posts');
    const contentHash = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    return ConfessionPost.create({
        id: confessionId,
        shardKey: 'general:20260620:0',
        roomId: 99999, // Stub roomId for testing
        alias: 'like_test_user',
        content: text,
        contentHash,
        author: Number(userId),
        likesCount: 0
    });
}

/**
 * Atomically toggle like/unlike for replies/comments.
 * Supports standard transactions with atomic fallbacks for standalone databases.
 */
async function toggleLikeReply({ replyId, userId }) {
    const uId = Number(userId);
    if (!uId) {
        const err = new Error('Unauthorized');
        err.status = 401;
        throw err;
    }

    let result = null;
    let transactionSupported = true;
    const session = await mongoose.startSession();

    try {
        await session.withTransaction(async () => {
            result = await performReplyLikeToggle(replyId, uId, session);
        });
    } catch (error) {
        const errMsg = error.message || '';
        if (
            errMsg.includes('Transaction numbers are only allowed on a replica set member') ||
            errMsg.includes('sessions are not supported') ||
            error.codeName === 'IllegalOperation' ||
            error.code === 20
        ) {
            transactionSupported = false;
        } else {
            throw error;
        }
    } finally {
        session.endSession();
    }

    if (!transactionSupported) {
        console.warn('MongoDB transactions not supported for replies. Falling back to non-transactional atomic operation.');
        result = await performReplyLikeToggle(replyId, uId, null);
    }

    if (result) {
        likeEmitter.emit('reply:likesUpdated', {
            roomId: result.roomId,
            replyId: Number(result.replyId),
            likesCount: result.likesCount
        });
    }

    return result;
}

async function performReplyLikeToggle(replyId, userId, session) {
    const opt = session ? { session } : {};

    let query = {};
    if (mongoose.Types.ObjectId.isValid(replyId)) {
        query = { _id: replyId };
    } else if (Number.isInteger(Number(replyId))) {
        query = { id: Number(replyId) };
    } else {
        const err = new Error('Invalid reply ID format');
        err.status = 400;
        throw err;
    }

    const reply = await ConfessionReply.findOne(query).session(session);
    if (!reply) {
        const err = new Error('Reply not found');
        err.status = 404;
        throw err;
    }

    const replyRefId = reply._id;

    const existingLike = await ReplyLike.findOne({ replyId: replyRefId, userId }).session(session);

    if (existingLike) {
        await ReplyLike.deleteOne({ _id: existingLike._id }, opt);

        const updatedReply = await ConfessionReply.findOneAndUpdate(
            { _id: replyRefId, likesCount: { $gt: 0 } },
            { $inc: { likesCount: -1, reactionCount: -1 } },
            { new: true, ...opt }
        );

        const likesCount = updatedReply ? updatedReply.likesCount : 0;

        return {
            roomId: reply.roomId,
            replyId: reply.id,
            likesCount,
            liked: false
        };
    } else {
        try {
            await ReplyLike.create([{ replyId: replyRefId, userId }], opt);
        } catch (err) {
            if (err.code === 11000) {
                const current = await ConfessionReply.findOne({ _id: replyRefId }).session(session);
                return {
                    roomId: reply.roomId,
                    replyId: reply.id,
                    likesCount: current ? current.likesCount : 0,
                    liked: true
                };
            }
            throw err;
        }

        const updatedReply = await ConfessionReply.findOneAndUpdate(
            { _id: replyRefId },
            { $inc: { likesCount: 1, reactionCount: 1 } },
            { new: true, ...opt }
        );

        const likesCount = updatedReply ? updatedReply.likesCount : 1;

        return {
            roomId: reply.roomId,
            replyId: reply.id,
            likesCount,
            liked: true
        };
    }
}

/**
 * Helper to create a new reply.
 */
async function createReply({ content, userId, confessionId, roomId }) {
    const text = String(content || '').trim();
    if (!text) {
        const err = new Error('Content is required');
        err.status = 400;
        throw err;
    }

    const replyId = await getNextSequence('confession_replies');
    const contentHash = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    return ConfessionReply.create({
        id: replyId,
        shardKey: 'general:20260620:0',
        roomId: Number(roomId) || 99999,
        confessionId: Number(confessionId),
        alias: 'like_test_user',
        content: text,
        contentHash,
        author: Number(userId),
        likesCount: 0
    });
}

module.exports = {
    toggleLikeConfession,
    toggleLikeReply,
    listFeed,
    listFeedAggregation,
    createConfession,
    createReply,
    likeEmitter
};
