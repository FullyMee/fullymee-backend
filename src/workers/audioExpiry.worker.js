const cron = require('node-cron');
const audioService = require('../services/audio.service');

const schedule = process.env.AUDIO_EXPIRY_CRON || '7 * * * *';

cron.schedule(schedule, async () => {
    try {
        const result = await audioService.deleteExpiredAudio({
            limit: Number(process.env.AUDIO_EXPIRY_BATCH || 100)
        });
        if (result && result.deleted > 0) {
            console.log(`[AudioExpiry] Deleted ${result.deleted} expired audio assets.`);
        }

        const orphanResult = await audioService.deleteOrphanAudio();
        if (orphanResult && orphanResult.deleted > 0) {
            console.log(`[AudioExpiry] Deleted ${orphanResult.deleted} orphan audio assets.`);
        }
    } catch (err) {
        console.error('[AudioExpiry] Failed:', err && err.message ? err.message : err);
    }
});
