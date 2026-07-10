const User = require('../models/user.model');
const { isConfiguredAdminUser } = require('../utils/adminAccess');

exports.requireModerationAdmin = async (req, res, next) => {
    try {
        const userId = Number(req.user && req.user.userId);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (isConfiguredAdminUser(userId)) {
            return next();
        }

        const user = await User.findOne({ id: userId })
            .select({ _id: 0, role: 1 })
            .lean();

        if (user && user.role === 'admin') {
            return next();
        }

        return res.status(403).json({ error: 'Admin access required' });
    } catch (err) {
        console.error('Admin guard failed:', err);
        return res.status(500).json({ error: 'Failed to validate admin access' });
    }
};
