const ConfessionRoom = require('../models/confessionRoom.model');
const { getRoomMetricMap } = require('./confessionMetrics.service');

function clamp(value, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
}

function getCurrentTimeSegment(date = new Date()) {
    const hour = date.getHours();
    if (hour >= 5 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 22) return 'evening';
    return 'night';
}

function getTimeWeight(room, segment) {
    if (segment === 'morning') return Number(room.timeWeightMorning || 1);
    if (segment === 'afternoon') return Number(room.timeWeightAfternoon || 1);
    if (segment === 'evening') return Number(room.timeWeightEvening || 1);
    return Number(room.timeWeightNight || 1);
}

function computeInterestMatch(room, interests) {
    const userInterests = new Set((interests || []).map((v) => String(v || '').trim().toLowerCase()).filter(Boolean));
    if (!userInterests.size) return 0.4;

    const roomTokens = new Set([
        String(room.category || '').toLowerCase(),
        ...(Array.isArray(room.tags) ? room.tags.map((v) => String(v || '').toLowerCase()) : [])
    ].filter(Boolean));

    if (!roomTokens.size) return 0;

    let hits = 0;
    for (const token of roomTokens) {
        if (userInterests.has(token)) hits += 1;
    }

    return clamp(hits / Math.max(1, roomTokens.size));
}

function computeEngagementRate(room, metric) {
    const m = metric || {};
    const interactions =
        Number(m.confessions || 0) * 2 +
        Number(m.replies || 0) * 1.5 +
        Number(m.reactions || 0) * 0.8;

    const participants = Math.max(1, Number(room.currentUserCount || 0));
    const raw = interactions / participants;
    return clamp(raw / 10); // normalize to roughly 0..1
}

function scoreRoom(room, metric, interests) {
    const engagementRate = computeEngagementRate(room, metric);
    const interestMatchScore = computeInterestMatch(room, interests);
    const availableCapacity = clamp(
        (Number(room.maxCapacity || 0) - Number(room.currentUserCount || 0)) / Math.max(1, Number(room.maxCapacity || 1))
    );
    const timeOfDayRelevance = clamp(getTimeWeight(room, getCurrentTimeSegment()) / 2, 0, 1);

    const totalScore =
        engagementRate * 0.35 +
        interestMatchScore * 0.35 +
        availableCapacity * 0.20 +
        timeOfDayRelevance * 0.10;

    return {
        totalScore,
        engagementRate,
        interestMatchScore,
        availableCapacity,
        timeOfDayRelevance
    };
}

async function recommendRooms({ interests = [], limit = 3, roomType = 'public' } = {}) {
    const now = new Date();
    const lim = Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.min(20, Number(limit)) : 3;

    const rooms = await ConfessionRoom.find({
        isActive: true,
        roomType: roomType === 'timed' ? 'timed' : 'public',
        $expr: { $lt: ['$currentUserCount', '$maxCapacity'] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    })
        .select({
            _id: 0,
            id: 1,
            title: 1,
            description: 1,
            category: 1,
            tags: 1,
            maxCapacity: 1,
            currentUserCount: 1,
            roomType: 1,
            expiresAt: 1,
            timeWeightMorning: 1,
            timeWeightAfternoon: 1,
            timeWeightEvening: 1,
            timeWeightNight: 1
        })
        .sort({ currentUserCount: -1, createdAt: -1 })
        .limit(200)
        .lean();

    if (!rooms.length) return [];

    const metricMap = await getRoomMetricMap(rooms.map((room) => room.id), 120);

    const scored = rooms.map((room) => {
        const scoreParts = scoreRoom(room, metricMap.get(room.id), interests);
        return {
            roomId: room.id,
            title: room.title,
            description: room.description,
            category: room.category,
            roomType: room.roomType,
            maxCapacity: room.maxCapacity,
            currentUserCount: room.currentUserCount,
            expiresAt: room.expiresAt || null,
            score: Number(scoreParts.totalScore.toFixed(4)),
            scoreBreakdown: {
                engagementRate: Number(scoreParts.engagementRate.toFixed(4)),
                interestMatchScore: Number(scoreParts.interestMatchScore.toFixed(4)),
                availableCapacity: Number(scoreParts.availableCapacity.toFixed(4)),
                timeOfDayRelevance: Number(scoreParts.timeOfDayRelevance.toFixed(4))
            }
        };
    });

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, lim);
}

module.exports = {
    recommendRooms
};
