const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const authController = require("../controllers/auth.controller");
const User = require('../models/user.model');
const ConfessionPost = require('../models/confessionPost.model');
const ConfessionReply = require('../models/confessionReply.model');
const ConfessionRoomMember = require('../models/confessionRoomMember.model');
const { z } = require('zod');
const { isConfiguredAdminUser } = require('../utils/adminAccess');

// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

const profileUpdateSchema = z.object({
    username: z.string()
        .trim()
        .min(3)
        .max(20)
        .regex(/^[a-z0-9._]+$/)
        .optional(),
    interests: z.array(z.string().trim().min(1).max(40)).max(20).optional(),

    // Identity preferences
    avatar: z.string().trim().max(50).optional(),

    // Chat controls
    chatRequestPermission: z.enum(['everyone', 'nobody']).optional(),
    limitNighttimeRequests: z.boolean().optional(),

    // Privacy & Safety
    hideJoinedRooms: z.boolean().optional(),
    hideProfileGlobal: z.boolean().optional(),
    audioExpiry: z.enum(['never', '24h', '7d', '30d']).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: shape user document into a safe API response object
// ─────────────────────────────────────────────────────────────────────────────

function formatUserResponse(user, isAdmin) {
    return {
        userId: user.id,
        email: user.email,
        username: user.username || null,
        interests: Array.isArray(user.interests) ? user.interests : [],
        role: isAdmin ? 'admin' : 'user',
        isAdmin,
        createdAt: user.createdAt,
        preferences: {
            avatar: (user.preferences && user.preferences.avatar) || 'flowing_waterfall',
            chatRequestPermission: (user.preferences && user.preferences.chatRequestPermission) || 'everyone',
            limitNighttimeRequests: !!(user.preferences && user.preferences.limitNighttimeRequests),
            hideJoinedRooms: !!(user.preferences && user.preferences.hideJoinedRooms),
            hideProfileGlobal: !!(user.preferences && user.preferences.hideProfileGlobal),
            audioExpiry: (user.preferences && user.preferences.audioExpiry) || 'never',
        }
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /users/me
// ─────────────────────────────────────────────────────────────────────────────

router.get('/me', authenticate, (req, res) => {
    User.findOne({ id: req.user.userId })
        .select({ _id: 0, id: 1, email: 1, username: 1, interests: 1, role: 1, createdAt: 1, preferences: 1 })
        .lean()
        .then((user) => {
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const hasAdminAccess = user.role === 'admin' || isConfiguredAdminUser(user.id);
            return res.status(200).json({ user: formatUserResponse(user, hasAdminAccess) });
        })
        .catch((err) => {
            console.error('Failed to fetch profile:', err);
            res.status(500).json({ error: 'Failed to fetch profile' });
        });
});

router.get("/", authenticate, authController.getAllUsers);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /users/preferences
// ─────────────────────────────────────────────────────────────────────────────

router.put('/preferences', authenticate, async (req, res) => {
    try {
        const parsed = profileUpdateSchema.safeParse(req.body || {});
        if (!parsed.success) {
            const issue = parsed.error.issues && parsed.error.issues[0];
            return res.status(400).json({ error: issue && issue.message ? issue.message : 'Invalid profile payload' });
        }

        const payload = parsed.data;
        const updates = {};

        // Top-level user fields
        if (payload.username !== undefined) {
            updates.username = String(payload.username).trim().toLowerCase();
        }
        if (payload.interests !== undefined) {
            updates.interests = payload.interests.map((v) => String(v).trim().toLowerCase());
        }

        // Preferences sub-doc fields — use dot-notation for partial updates
        const prefFields = ['avatar', 'chatRequestPermission', 'limitNighttimeRequests', 'hideJoinedRooms', 'hideProfileGlobal', 'audioExpiry'];
        for (const field of prefFields) {
            if (payload[field] !== undefined) {
                updates[`preferences.${field}`] = payload[field];
            }
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'No profile fields provided' });
        }

        const updated = await User.findOneAndUpdate(
            { id: req.user.userId },
            { $set: updates },
            { new: true, upsert: false }
        )
            .select({ _id: 0, id: 1, email: 1, username: 1, interests: 1, role: 1, createdAt: 1, preferences: 1 })
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hasAdminAccess = updated.role === 'admin' || isConfiguredAdminUser(updated.id);
        return res.status(200).json({ user: formatUserResponse(updated, hasAdminAccess) });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ error: 'Username is already taken' });
        }
        console.error('Failed to update user preferences:', err);
        return res.status(500).json({ error: 'Failed to update preferences' });
    }
});

const ChatRequest = require('../models/chatRequest.model');
const Conversation = require('../models/conversation.model');

router.get('/:identifier/profile', authenticate, async (req, res) => {
    try {
        const identifier = String(req.params.identifier).trim();
        const currentUserId = req.user.userId;

        // Fetch current user details
        const currentUser = await User.findOne({ id: currentUserId }).lean();
        const currentUsername = currentUser?.username ? currentUser.username.toLowerCase() : null;

        // 1. Check if identifier belongs to current logged-in user (isSelf)
        let isSelf = false;
        if (/^\d+$/.test(identifier) && Number(identifier) === currentUserId) {
            isSelf = true;
        } else if (currentUsername && identifier.toLowerCase() === currentUsername) {
            isSelf = true;
        } else {
            // Check if identifier matches any room alias of the current user
            const ownMember = await ConfessionRoomMember.findOne({
                userId: currentUserId,
                alias: { $regex: new RegExp(`^${identifier.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i') }
            }).lean();
            if (ownMember) {
                isSelf = true;
            }
        }

        if (isSelf) {
            return res.status(200).json({
                isSelf: true,
                userId: currentUserId,
                username: currentUser?.username || identifier,
                avatar: currentUser?.preferences?.avatar || null,
                createdAt: currentUser?.createdAt
            });
        }

        // 2. Resolve target user or alias
        const escapedIdentifier = identifier.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
        let targetUser = await User.findOne({ username: { $regex: new RegExp(`^${escapedIdentifier}$`, 'i') } }).lean();
        if (!targetUser && /^\d+$/.test(identifier)) {
            targetUser = await User.findOne({ id: Number(identifier) }).lean();
        }

        // If not found directly, check if identifier is a room alias belonging to another user
        if (!targetUser) {
            const memberRec = await ConfessionRoomMember.findOne({
                alias: { $regex: new RegExp(`^${escapedIdentifier}$`, 'i') }
            }).lean();
            if (memberRec) {
                targetUser = await User.findOne({ id: memberRec.userId }).lean();
            }
        }

        // 2b. Check if targetUser has hidden their profile globally
        if (targetUser && targetUser.preferences?.hideProfileGlobal) {
            return res.status(200).json({
                isSelf: false,
                isProfileHidden: true,
                username: targetUser.username || identifier
            });
        }

        const targetUserId = targetUser ? targetUser.id : null;

        // 3. Check connection status (accepted chat request or active conversation)
        let isConnected = false;
        let conversationId = null;

        if (targetUserId) {
            const acceptedRequest = await ChatRequest.findOne({
                $or: [
                    { requesterUserId: currentUserId, targetUserId: targetUserId },
                    { requesterUserId: targetUserId, targetUserId: currentUserId }
                ],
                status: 'accepted'
            }).lean();

            if (acceptedRequest) {
                isConnected = true;
                conversationId = acceptedRequest.conversationId || null;
            }

            if (!conversationId) {
                const dmConv = await Conversation.findOne({
                    type: 'dm',
                    participants: { $all: [currentUserId, targetUserId] }
                }).lean();
                if (dmConv) {
                    isConnected = true;
                    conversationId = dmConv.id;
                }
            }
        }

        // 4. Calculate stats
        let confessionsCount = 0;
        let repliesCount = 0;
        let roomsCount = 0;

        if (targetUserId) {
            const [confessions, replies, members] = await Promise.all([
                ConfessionPost.countDocuments({ author: targetUserId, isPublished: true, isHidden: false }),
                ConfessionReply.countDocuments({ author: targetUserId, isHidden: false }),
                ConfessionRoomMember.countDocuments({ userId: targetUserId, isActive: true })
            ]);
            confessionsCount = confessions;
            repliesCount = replies;
            roomsCount = members;
        } else {
            // Pure alias stats fallback
            const [confessions, replies, roomsList] = await Promise.all([
                ConfessionPost.countDocuments({ alias: identifier, isPublished: true, isHidden: false }),
                ConfessionReply.countDocuments({ alias: identifier, isHidden: false }),
                ConfessionPost.distinct('roomId', { alias: identifier, isPublished: true, isHidden: false })
            ]);
            confessionsCount = confessions;
            repliesCount = replies;
            roomsCount = roomsList.length;
        }

        return res.status(200).json({
            isSelf: false,
            isProfileHidden: false,
            isConnected,
            conversationId,
            userId: targetUserId,
            username: targetUser ? targetUser.username : identifier,
            avatar: targetUser ? targetUser.preferences?.avatar : null,
            createdAt: targetUser ? targetUser.createdAt : null,
            stats: {
                confessions: confessionsCount,
                rooms: roomsCount,
                replies: repliesCount
            }
        });
    } catch (err) {
        console.error('Failed to fetch user profile:', err);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

module.exports = router;
