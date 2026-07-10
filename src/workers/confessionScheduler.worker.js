const cron = require('node-cron');
const confessionService = require('../services/confession.service');
const { getOnlineUsers } = require('../utils/socket');

let isRunning = false;

// Runs every 30 seconds
cron.schedule('*/30 * * * * *', async () => {
    if (isRunning) return;
    isRunning = true;

    try {
        const { published, notified } = await confessionService.publishDueScheduledConfessions(getOnlineUsers);

        if (published > 0 || notified > 0) {
            console.log(`[Scheduler] Published ${published} scheduled confession(s), notified ${notified} user(s) for confirmation.`);
        }
    } catch (err) {
        console.error('[Scheduler] Error publishing scheduled confessions:', err && err.message ? err.message : err);
    } finally {
        isRunning = false;
    }
});
