const ConfessionMetric = require('../models/confessionMetric.model');

function getBucketStart(date = new Date()) {
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    return d;
}

async function incrementRoomMetric(roomId, inc = {}, set = {}) {
    if (!roomId) return;

    const bucketStart = getBucketStart();
    const $inc = {};
    Object.entries(inc || {}).forEach(([key, value]) => {
        if (!Number.isFinite(value) || value === 0) return;
        $inc[key] = value;
    });

    const update = {
        $set: {
            updatedAt: new Date(),
            ...set
        }
    };

    if (Object.keys($inc).length) {
        update.$inc = $inc;
    }

    await ConfessionMetric.updateOne(
        { roomId, bucketStart },
        update,
        { upsert: true, setDefaultsOnInsert: true }
    );
}

async function getRoomMetricMap(roomIds, lookbackMinutes = 120) {
    const ids = Array.from(new Set((roomIds || []).map((v) => Number(v)).filter(Boolean)));
    if (!ids.length) return new Map();

    const now = Date.now();
    const from = new Date(now - lookbackMinutes * 60 * 1000);

    const rows = await ConfessionMetric.aggregate([
        {
            $match: {
                roomId: { $in: ids },
                bucketStart: { $gte: from }
            }
        },
        {
            $group: {
                _id: '$roomId',
                joins: { $sum: '$joins' },
                leaves: { $sum: '$leaves' },
                confessions: { $sum: '$confessions' },
                replies: { $sum: '$replies' },
                reactions: { $sum: '$reactions' },
                reports: { $sum: '$reports' },
                flags: { $sum: '$flags' },
                blocks: { $sum: '$blocks' },
                totalSessionSeconds: { $sum: '$totalSessionSeconds' }
            }
        }
    ]);

    const map = new Map();
    rows.forEach((row) => {
        map.set(Number(row._id), {
            joins: Number(row.joins || 0),
            leaves: Number(row.leaves || 0),
            confessions: Number(row.confessions || 0),
            replies: Number(row.replies || 0),
            reactions: Number(row.reactions || 0),
            reports: Number(row.reports || 0),
            flags: Number(row.flags || 0),
            blocks: Number(row.blocks || 0),
            totalSessionSeconds: Number(row.totalSessionSeconds || 0)
        });
    });

    return map;
}

async function getRoomMetricsSummary(roomId, from, to) {
    const roomIdNum = Number(roomId);
    if (!roomIdNum) return null;

    const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const toDate = to ? new Date(to) : new Date();

    const [row] = await ConfessionMetric.aggregate([
        {
            $match: {
                roomId: roomIdNum,
                bucketStart: { $gte: fromDate, $lte: toDate }
            }
        },
        {
            $group: {
                _id: '$roomId',
                joins: { $sum: '$joins' },
                leaves: { $sum: '$leaves' },
                confessions: { $sum: '$confessions' },
                replies: { $sum: '$replies' },
                reactions: { $sum: '$reactions' },
                reports: { $sum: '$reports' },
                flags: { $sum: '$flags' },
                blocks: { $sum: '$blocks' },
                totalSessionSeconds: { $sum: '$totalSessionSeconds' }
            }
        }
    ]);

    if (!row) {
        return {
            roomId: roomIdNum,
            joins: 0,
            leaves: 0,
            confessions: 0,
            replies: 0,
            reactions: 0,
            reports: 0,
            flags: 0,
            blocks: 0,
            totalSessionSeconds: 0
        };
    }

    return {
        roomId: roomIdNum,
        joins: Number(row.joins || 0),
        leaves: Number(row.leaves || 0),
        confessions: Number(row.confessions || 0),
        replies: Number(row.replies || 0),
        reactions: Number(row.reactions || 0),
        reports: Number(row.reports || 0),
        flags: Number(row.flags || 0),
        blocks: Number(row.blocks || 0),
        totalSessionSeconds: Number(row.totalSessionSeconds || 0)
    };
}

module.exports = {
    incrementRoomMetric,
    getRoomMetricMap,
    getRoomMetricsSummary
};
