const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const authController = require("../controllers/auth.controller");
const User = require('../models/user.model');
const { z } = require('zod');
const { isConfiguredAdminUser } = require('../utils/adminAccess');

const profileUpdateSchema = z.object({
    username: z.string()
        .trim()
        .min(3)
        .max(20)
        .regex(/^[a-z0-9._]+$/)
        .optional(),
    interests: z.array(z.string().trim().min(1).max(40)).max(20).optional()
});

router.get('/me', authenticate, (req, res) => {
    User.findOne({ id: req.user.userId })
        .select({ _id: 0, id: 1, email: 1, username: 1, interests: 1, role: 1, createdAt: 1 })
        .lean()
        .then((user) => {
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const hasAdminAccess = user.role === 'admin' || isConfiguredAdminUser(user.id);

            return res.status(200).json({
                user: {
                    userId: user.id,
                    email: user.email,
                    username: user.username,
                    interests: Array.isArray(user.interests) ? user.interests : [],
                    role: hasAdminAccess ? 'admin' : 'user',
                    isAdmin: hasAdminAccess,
                    createdAt: user.createdAt
                }
            });
        })
        .catch((err) => {
            console.error('Failed to fetch profile:', err);
            res.status(500).json({ error: 'Failed to fetch profile' });
        });
});

router.get("/", authenticate, authController.getAllUsers);

router.put('/preferences', authenticate, async (req, res) => {
    try {
        const parsed = profileUpdateSchema.safeParse(req.body || {});
        if (!parsed.success) {
            const issue = parsed.error.issues && parsed.error.issues[0];
            return res.status(400).json({ error: issue && issue.message ? issue.message : 'Invalid profile payload' });
        }

        const payload = parsed.data;
        const updates = {};

        if (payload.username !== undefined) {
            updates.username = String(payload.username).trim().toLowerCase();
        }

        if (payload.interests !== undefined) {
            updates.interests = payload.interests.map((v) => String(v).trim().toLowerCase());
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({ error: 'No profile fields provided' });
        }

        const updated = await User.findOneAndUpdate(
            { id: req.user.userId },
            { $set: updates },
            { new: true }
        )
            .select({ _id: 0, id: 1, email: 1, username: 1, interests: 1, role: 1, createdAt: 1 })
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'User not found' });
        }

        const hasAdminAccess = updated.role === 'admin' || isConfiguredAdminUser(updated.id);

        return res.status(200).json({
            user: {
                userId: updated.id,
                email: updated.email,
                username: updated.username || null,
                interests: Array.isArray(updated.interests) ? updated.interests : [],
                role: hasAdminAccess ? 'admin' : 'user',
                isAdmin: hasAdminAccess,
                createdAt: updated.createdAt
            }
        });
    } catch (err) {
        if (err && err.code === 11000) {
            return res.status(409).json({ error: 'Username is already taken' });
        }
        console.error('Failed to update user preferences:', err);
        return res.status(500).json({ error: 'Failed to update preferences' });
    }
});

module.exports = router;
