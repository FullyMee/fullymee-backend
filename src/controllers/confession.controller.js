const confessionService = require('../services/confession.service');
const likeService = require('../services/like.service');

const {
    joinRoomSchema,
    createRoomSchema,
    joinRoomByCodeSchema,
    postConfessionSchema,
    postReplySchema,
    reactSchema,
    reportSchema,
    roomIdParamsSchema,
    confessionIdParamsSchema,
    listQuerySchema,
    recommendationQuerySchema,
    publicRoomQuerySchema,
    analyticsQuerySchema,
    moderationQueueQuerySchema,
    moderationQueueIdParamsSchema,
    resolveModerationSchema
} = require('../validators/confession.validator');

function parseOrThrow(schema, payload) {
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
        const issue = parsed.error.issues && parsed.error.issues[0];
        const message = issue && issue.message ? issue.message : 'Invalid request payload';
        const err = new Error(message);
        err.status = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    return parsed.data;
}

function handleControllerError(res, err, fallbackMessage) {
    if (err && Number.isFinite(err.retryAfterSec)) {
        res.set('Retry-After', String(Math.max(1, Math.floor(err.retryAfterSec))));
    }

    if (err && Number.isFinite(err.status)) {
        return res.status(err.status).json({ error: err.message || fallbackMessage });
    }

    console.error(fallbackMessage, err);
    return res.status(500).json({ error: fallbackMessage });
}

exports.joinRoom = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const body = parseOrThrow(joinRoomSchema, req.body || {});
        const room = await confessionService.joinRoom({ userId, ...body });
        res.status(200).json(room);
    } catch (err) {
        handleControllerError(res, err, 'Failed to join confession room');
    }
};

exports.createRoom = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const body = parseOrThrow(createRoomSchema, req.body || {});
        const room = await confessionService.createRoom({ userId, ...body });
        res.status(201).json(room);
    } catch (err) {
        handleControllerError(res, err, 'Failed to create confession room');
    }
};

exports.joinRoomByCode = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const body = parseOrThrow(joinRoomByCodeSchema, req.body || {});
        const room = await confessionService.joinRoomByCode({ userId, ...body });
        res.status(200).json(room);
    } catch (err) {
        handleControllerError(res, err, 'Failed to join private confession room');
    }
};

exports.leaveRoom = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const result = await confessionService.leaveRoom({ userId, roomId: params.roomId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to leave confession room');
    }
};

exports.shuffleAlias = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const result = await confessionService.shuffleAlias({ userId, roomId: params.roomId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to shuffle alias');
    }
};

exports.listMyScheduledConfessions = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const result = await confessionService.listMyScheduledConfessions({ userId, roomId: params.roomId });
        res.status(200).json({ scheduled: result });
    } catch (err) {
        handleControllerError(res, err, 'Failed to list scheduled confessions');
    }
};

exports.confirmPublishConfession = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomId = Number(req.params && req.params.roomId);
        const confessionId = Number(req.params && req.params.confessionId);
        if (!roomId || !confessionId) {
            return res.status(400).json({ message: 'Invalid parameters.' });
        }
        const result = await confessionService.confirmPublishConfession({ userId, confessionId, roomId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to confirm publish');
    }
};

exports.cancelScheduledConfession = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomId = Number(req.params && req.params.roomId);
        const confessionId = Number(req.params && req.params.confessionId);
        if (!roomId || !confessionId) {
            return res.status(400).json({ message: 'Invalid parameters.' });
        }
        const result = await confessionService.cancelScheduledConfession({ userId, confessionId, roomId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to cancel scheduled confession');
    }
};

exports.getMyRooms = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const rows = await confessionService.listMyRooms({ userId });
        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch joined rooms');
    }
};

exports.getMyConfessions = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const query = parseOrThrow(listQuerySchema, req.query || {});
        const rows = await confessionService.listMyConfessions({
            userId,
            limit: query.limit
        });
        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch your confessions');
    }
};

exports.getRecommendations = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const query = parseOrThrow(recommendationQuerySchema, req.query || {});
        const rows = await confessionService.getRecommendations({ userId, ...query });
        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch room recommendations');
    }
};

exports.getPublicRooms = async (req, res) => {
    try {
        const query = parseOrThrow(publicRoomQuerySchema, req.query || {});
        const paginate = String((req.query && req.query.paginate) || '').toLowerCase() === '1' || String((req.query && req.query.paginate) || '').toLowerCase() === 'true';
        const limit = Number(query.limit || 100);
        const rows = await confessionService.listPublicRooms({
            ...query,
            limit: paginate ? Math.min(100, limit + 1) : limit
        });

        if (paginate) {
            const items = rows.slice(0, limit);
            return res.status(200).json({
                items,
                hasMore: rows.length > limit
            });
        }

        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch public rooms');
    }
};

exports.getRoomMembers = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const members = await confessionService.listRoomMembers({
            userId,
            roomId: params.roomId
        });
        res.status(200).json(members);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch room members');
    }
};

exports.listConfessions = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const query = parseOrThrow(listQuerySchema, req.query || {});
        const rows = await confessionService.listConfessions({
            userId,
            roomId: params.roomId,
            limit: query.limit,
            sortBy: query.sortBy || 'ranked'
        });
        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch confessions');
    }
};

exports.postConfession = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const body = parseOrThrow(postConfessionSchema, req.body || {});
        const result = await confessionService.postConfession({
            userId,
            roomId: params.roomId,
            content: body.content,
            scheduledAt: body.scheduledAt || null,
            audioPublicId: body.audioPublicId || null,
            audioDuration: body.audioDuration || null
        });
        res.status(201).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to publish confession');
    }
};

exports.getAudioUploadToken = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const result = await confessionService.getAudioUploadToken({
            userId,
            roomId: params.roomId
        });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to create audio upload token');
    }
};

exports.getConfessionAudioUrl = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomParams = parseOrThrow(roomIdParamsSchema, req.params || {});
        const confessionParams = parseOrThrow(confessionIdParamsSchema, req.params || {});
        const result = await confessionService.getConfessionAudioUrl({
            userId,
            roomId: roomParams.roomId,
            confessionId: confessionParams.confessionId
        });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to load audio');
    }
};

exports.listReplies = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomParams = parseOrThrow(roomIdParamsSchema, req.params || {});
        const confessionParams = parseOrThrow(confessionIdParamsSchema, req.params || {});
        const query = parseOrThrow(listQuerySchema, req.query || {});
        const rows = await confessionService.listReplies({
            userId,
            roomId: roomParams.roomId,
            confessionId: confessionParams.confessionId,
            limit: query.limit
        });
        res.status(200).json(rows);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch replies');
    }
};

exports.postReply = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomParams = parseOrThrow(roomIdParamsSchema, req.params || {});
        const confessionParams = parseOrThrow(confessionIdParamsSchema, req.params || {});
        const body = parseOrThrow(postReplySchema, req.body || {});
        const result = await confessionService.postReply({
            userId,
            roomId: roomParams.roomId,
            confessionId: confessionParams.confessionId,
            content: body.content,
            parentReplyId: body.parentReplyId || null,
            parentAlias: body.parentAlias || null
        });
        res.status(201).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to publish reply');
    }
};

exports.sendChatRequest = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const roomParams = parseOrThrow(roomIdParamsSchema, req.params || {});
        const confessionParams = parseOrThrow(confessionIdParamsSchema, req.params || {});
        const result = await confessionService.sendChatRequestForConfession({
            userId,
            roomId: roomParams.roomId,
            confessionId: confessionParams.confessionId
        });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to send chat request');
    }
};

exports.react = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const body = parseOrThrow(reactSchema, req.body || {});
        const result = await confessionService.reactToTarget({
            userId,
            roomId: params.roomId,
            ...body
        });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to apply reaction');
    }
};

exports.report = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const params = parseOrThrow(roomIdParamsSchema, req.params || {});
        const body = parseOrThrow(reportSchema, req.body || {});
        const result = await confessionService.reportTarget({
            userId,
            roomId: params.roomId,
            ...body
        });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to submit report');
    }
};

exports.analyticsSummary = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const query = parseOrThrow(analyticsQuerySchema, req.query || {});
        const summary = await confessionService.getAnalyticsSummary({
            userId,
            roomId: query.roomId,
            from: query.from,
            to: query.to
        });
        res.status(200).json(summary);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch analytics summary');
    }
};

exports.listModerationQueue = async (req, res) => {
    try {
        const query = parseOrThrow(moderationQueueQuerySchema, req.query || {});
        const result = await confessionService.listModerationQueue(query);
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch moderation queue');
    }
};

exports.resolveModerationQueueItem = async (req, res) => {
    try {
        const moderatorUserId = req.user && req.user.userId;
        const params = parseOrThrow(moderationQueueIdParamsSchema, req.params || {});
        const body = parseOrThrow(resolveModerationSchema, req.body || {});

        const result = await confessionService.resolveModerationQueueItem({
            moderatorUserId,
            queueId: params.queueId,
            resolutionAction: body.action,
            resolutionReason: body.reason || null
        });

        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to resolve moderation queue item');
    }
};

exports.likeConfession = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const confessionId = req.params.id;

        const result = await likeService.toggleLikeConfession({ confessionId, userId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to toggle like on confession');
    }
};

exports.likeReply = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const replyId = req.params.id;

        const result = await likeService.toggleLikeReply({ replyId, userId });
        res.status(200).json(result);
    } catch (err) {
        handleControllerError(res, err, 'Failed to toggle like on reply');
    }
};

exports.createConfession = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const { content } = req.body || {};

        const confession = await likeService.createConfession({ content, userId });
        res.status(201).json(confession);
    } catch (err) {
        handleControllerError(res, err, 'Failed to publish confession');
    }
};

exports.listConfessionsFeed = async (req, res) => {
    try {
        const userId = req.user && req.user.userId;
        const { limit, offset, useAggregation } = req.query || {};

        let confessions;
        if (useAggregation === 'true' || useAggregation === '1') {
            confessions = await likeService.listFeedAggregation({
                userId,
                limit: Number(limit) || 20,
                offset: Number(offset) || 0
            });
        } else {
            confessions = await likeService.listFeed({
                userId,
                limit: Number(limit) || 20,
                offset: Number(offset) || 0
            });
        }
        res.status(200).json(confessions);
    } catch (err) {
        handleControllerError(res, err, 'Failed to fetch confessions feed');
    }
};
