const { getRequestToken, verifyAuthToken } = require('../utils/authToken');
const metrics = require('../metrics/prometheus');
const User = require('../models/user.model');

exports.authenticate = async (req, res, next) => {
    try {
        const token = getRequestToken(req);
        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = verifyAuthToken(token);
        if (!decoded || !decoded.userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const user = await User.findOne({ id: Number(decoded.userId) }).select({ tokenVersion: 1, id: 1 }).lean();
            if (!user) return res.status(401).json({ error: 'Unauthorized' });
            if (Number(user.tokenVersion || 0) !== Number(decoded.tokenVersion || 0)) {
                metrics.recordAuthTokenVersionMismatch();
                return res.status(401).json({ error: 'Token revoked' });
            }
        } catch (e) {
            try {
                console.error('Auth middleware DB error:', e && e.message ? e.message : e);
            } catch (_) {}
            const name = e && e.name ? e.name : '';
            if (name.includes('Mongo') || name.includes('MongoNetworkError') || name.includes('MongoServerSelectionError')) {
                return res.status(503).json({ error: 'Service unavailable' });
            }
            return res.status(401).json({ error: 'Unauthorized' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        try {
            console.error('Auth middleware error:', err && err.message ? err.message : err);
        } catch (_) {}
        return res.status(401).json({ error: 'Unauthorized' });
    }
};
