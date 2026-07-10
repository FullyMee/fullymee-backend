const cron = require('node-cron');
const Message = require('../models/message.model');
let isCleanupRunning = false;

/*
Runs every minute.

Why every minute?
- Good balance of freshness and load
- Cheap DB operation
- Suitable for messaging systems
*/

cron.schedule('* * * * *', async () => {
    if (isCleanupRunning) return;
    isCleanupRunning = true;

    try {
        const startedAt = Date.now();
        const cleanupBatchRaw = Number(process.env.MESSAGE_CLEANUP_BATCH || 1000);
        const cleanupBatch = Number.isFinite(cleanupBatchRaw) && cleanupBatchRaw > 0
            ? cleanupBatchRaw
            : 1000;

        const expired = await Message.find(
            { expiresAt: { $lte: new Date() } },
            { _id: 1 }
        )
            .sort({ id: 1 })
            .limit(cleanupBatch)
            .lean();

        if (!expired.length) return;

        const ids = expired.map((row) => row._id);
        const result = await Message.deleteMany({ _id: { $in: ids } });

        if (result.deletedCount > 0) {
            console.log(`Expiry Worker -> Deleted ${result.deletedCount} messages`);
        }

        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 30000) {
            console.warn(`Expiry Worker -> Cleanup took ${elapsedMs}ms`);
        }
    } catch (err) {
        console.error('Expiry Worker Error:', err);
    } finally {
        isCleanupRunning = false;
    }
});
