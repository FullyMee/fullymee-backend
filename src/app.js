require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const { pingDB } = require('./config/db');

const { hydrateRateLimitIdentity, apiUserLimiter, apiIpLimiter } = require('./middleware/rateLimit.middleware');
const verifyCsrfToken = require('./middleware/csrf.middleware');
 
const app = express();
app.disable('x-powered-by');

function getTrustProxySetting() {
    const raw = String(process.env.TRUST_PROXY || '').trim();
    if (!raw) return 1;
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw;
}

function getJsonBodyLimit() {
    const raw = String(process.env.API_JSON_LIMIT || '').trim();
    return raw || '1mb';
}

app.set('trust proxy', getTrustProxySetting());

function getAllowedOrigins() {
    const raw = String(process.env.CORS_ORIGIN || '').trim();
    if (!raw) {
        return ['http://localhost:5173', 'http://localhost:3000'];
    }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

const allowedOrigins = getAllowedOrigins();

/* Health check */
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

/* Readiness check */
app.get('/ready', async (req, res) => {
    const status = {
        status: 'ok',
        checks: {
            database: 'ok'
        }
    };

    try {
        await pingDB();
    } catch (err) {
        status.status = 'error';
        status.checks.database = 'error';
    }

    res.status(status.status === 'ok' ? 200 : 503).json(status);
});

/* Core Middleware */
app.use(helmet());
app.use(compression());
app.use(cors({
    origin: function (origin, callback) {

        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true
}));
app.use(express.json({ limit: getJsonBodyLimit() }));
app.use(express.urlencoded({ extended: false, limit: getJsonBodyLimit() }));
app.use(verifyCsrfToken);

/* Global rate limiter */
app.use(hydrateRateLimitIdentity);
app.use(apiUserLimiter);
app.use(apiIpLimiter);

/* Routes */
const authRoutes = require('./routes/auth.routes');
app.use('/api/auth', authRoutes);

const userRoutes = require('./routes/user.routes');
app.use('/api/users', userRoutes);

const messageRoutes = require('./routes/message.routes');
app.use('/api/messages', messageRoutes);

const conversationRoutes = require('./routes/conversation.routes');
app.use('/api/conversations', conversationRoutes);

const notificationRoutes = require('./routes/notification.routes');
app.use('/api/notifications', notificationRoutes);

const confessionRoutes = require('./routes/confession.routes');
app.use('/api/confessions', confessionRoutes);

app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
    if (res.headersSent) {
        return next(err);
    }

    if (err && err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }

    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    console.error('Unhandled application error:', err);
    return res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
