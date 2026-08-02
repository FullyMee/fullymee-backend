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
    avatar: z.string().trim().max(10).optional(),

    // Chat controls
    chatRequestPermission: z.enum(['everyone', 'nobody']).optional(),
    limitNighttimeRequests: z.boolean().optional(),

    // Privacy & Safety
    hideJoinedRooms: z.boolean().optional(),
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
            avatar: (user.preferences && user.preferences.avatar) || '🌊',
            chatRequestPermission: (user.preferences && user.preferences.chatRequestPermission) || 'everyone',
            limitNighttimeRequests: !!(user.preferences && user.preferences.limitNighttimeRequests),
            hideJoinedRooms: !!(user.preferences && user.preferences.hideJoinedRooms),
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
        const prefFields = ['avatar', 'chatRequestPermission', 'limitNighttimeRequests', 'hideJoinedRooms', 'audioExpiry'];
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

router.get('/:identifier/profile', authenticate, async (req, res) => {
    try {
        const identifier = String(req.params.identifier).trim();
        let user = await User.findOne({ username: { $regex: new RegExp(`^${identifier}$`, 'i') } }).lean();

        // If not found by username, let's check if it's an ID
        if (!user && /^\d+$/.test(identifier)) {
            user = await User.findOne({ id: Number(identifier) }).lean();
        }

        if (user) {
            // It's a real user
            const [confessions, replies, rooms] = await Promise.all([
                ConfessionPost.countDocuments({ author: user.id, isPublished: true, isHidden: false }),
                ConfessionReply.countDocuments({ author: user.id, isHidden: false }),
                ConfessionRoomMember.countDocuments({ userId: user.id, status: 'active' })
            ]);

            return res.status(200).json({
                isAlias: false,
                username: user.username,
                userId: user.id,
                createdAt: user.createdAt,
                stats: { confessions, rooms, replies }
            });
        } else {
            // Treat as an alias
            const [confessions, replies, roomsList] = await Promise.all([
                ConfessionPost.countDocuments({ alias: identifier, isPublished: true, isHidden: false }),
                ConfessionReply.countDocuments({ alias: identifier, isHidden: false }),
                ConfessionPost.distinct('roomId', { alias: identifier, isPublished: true, isHidden: false })
            ]);

            return res.status(200).json({
                isAlias: true,
                username: identifier,
                stats: { confessions, rooms: roomsList.length, replies }
            });
        }
    } catch (err) {
        console.error('Failed to fetch user profile:', err);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

module.exports = router;
