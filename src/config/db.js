const mongoose = require('mongoose');

let connected = false;
let connectPromise = null;

mongoose.set('bufferCommands', false);

mongoose.connection.on('connected', () => {
    connected = true;
});

mongoose.connection.on('disconnected', () => {
    connected = false;
});

async function connectDB() {
    if (connected && mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }
    if (connectPromise) {
        return connectPromise;
    }

    const uri = String(process.env.MONGODB_URI || '').trim();
    if (!uri) {
        throw new Error('Missing required env: MONGODB_URI');
    }

    const dbName = String(process.env.MONGODB_DB || '').trim();
    const maxPoolSize = Number(process.env.MONGODB_MAX_POOL_SIZE || 20);
    const minPoolSize = Number(process.env.MONGODB_MIN_POOL_SIZE || 0);
    const maxIdleTimeMS = Number(process.env.MONGODB_MAX_IDLE_MS || 60000);

    connectPromise = mongoose.connect(uri, {
        dbName: dbName || undefined,
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: Number.isFinite(maxPoolSize) ? maxPoolSize : 20,
        minPoolSize: Number.isFinite(minPoolSize) ? minPoolSize : 0,
        maxIdleTimeMS: Number.isFinite(maxIdleTimeMS) ? maxIdleTimeMS : 60000
    })
        .then(() => {
            connected = true;
            return mongoose.connection;
        })
        .catch((err) => {
            connected = false;
            throw err;
        })
        .finally(() => {
            connectPromise = null;
        });

    return connectPromise;
}

async function pingDB() {
    if (!(connected && mongoose.connection.readyState === 1)) {
        await connectDB();
    }
    await mongoose.connection.db.admin().ping();
    return { status: 'ok' };
}

module.exports = { mongoose, connectDB, pingDB };
