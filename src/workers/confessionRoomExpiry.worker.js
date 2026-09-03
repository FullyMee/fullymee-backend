const cron = require('node-cron');
const confessionService = require('../services/confession.service');
let isConfessionCleanupRunning = false;

// Runs every minute to keep timed rooms and public-room occupancy healthy.
cron.schedule('* * * * *', async () => {
    if (isConfessionCleanupRunning) return;
    isConfessionCleanupRunning = true;

    try {
        const startedAt = Date.now();
        const expiredCount = await confessionService.expireTimedRooms();
        if (expiredCount > 0) {
            console.log(`Confession Room Expiry -> expired ${expiredCount} timed room(s)`);
        }

        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 30000) {
            console.warn(`Confession Room Expiry -> Cleanup took ${elapsedMs}ms`);
        }
    } catch (err) {
        console.error('Confession Room Expiry Worker Error:', err);
    } finally {
        isConfessionCleanupRunning = false;
    }
});
