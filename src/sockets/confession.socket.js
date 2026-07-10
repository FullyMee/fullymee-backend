const { z } = require('zod');
const confessionService = require('../services/confession.service');
const likeService = require('../services/like.service');


const roomSchema = z.object({
    roomId: z.number().int().positive()
});

const postSchema = z.object({
    roomId: z.number().int().positive(),
    content: z.string().min(1).max(200),
    scheduledAt: z.string().datetime().optional()
});

const replySchema = z.object({
    roomId: z.number().int().positive(),
    confessionId: z.number().int().positive(),
    content: z.string().min(1).max(1500)
});

const reactSchema = z.object({
    roomId: z.number().int().positive(),
    targetType: z.enum(['confession', 'reply']),
    targetId: z.number().int().positive(),
    reactionType: z.enum(['support', 'empathy', 'agree', 'insight', 'heart'])
});

function roomChannel(roomId) {
    return `confession_room_${roomId}`;
}

async function emitRoomMembersSnapshot(io, roomId) {
    try {
        const members = await confessionService.listRoomMembers({ roomId });
        io.to(roomChannel(roomId)).emit('confession_room_members_updated', {
            roomId,
            members
        });
    } catch (err) {
        // non-fatal
    }
}

async function ensureMembership(userId, roomId) {
    const rooms = await confessionService.getUserActiveRooms(userId);
    return rooms.some((row) => Number(row.roomId) === Number(roomId));
}

function wireServiceEmitter(io) {
    likeService.likeEmitter.on('confession:likesUpdated', ({ confessionId, likesCount }) => {
        io.emit('confession:likesUpdated', { confessionId, likesCount });
    });

    likeService.likeEmitter.on('reply:likesUpdated', ({ roomId, replyId, likesCount }) => {
        io.to(roomChannel(roomId)).emit('confession_reaction_updated', {
            targetType: 'reply',
            targetId: replyId,
            reactionCount: likesCount
        });
    });

    confessionService.emitter.on('confession_created', ({ roomId, confession }) => {

        io.to(roomChannel(roomId)).emit('confession_created', confession);
    });

    confessionService.emitter.on('confession_reply_created', ({ roomId, confessionId, reply }) => {
        io.to(roomChannel(roomId)).emit('confession_reply_created', { confessionId, reply });
    });

    confessionService.emitter.on('confession_reaction_updated', ({ roomId, targetType, targetId, reactionCount }) => {
        io.to(roomChannel(roomId)).emit('confession_reaction_updated', { targetType, targetId, reactionCount });
    });

    confessionService.emitter.on('confession_content_hidden', ({ roomId, targetType, targetId, reason }) => {
        io.to(roomChannel(roomId)).emit('confession_content_hidden', { targetType, targetId, reason });
    });

    confessionService.emitter.on('confession_room_expired', ({ roomId }) => {
        io.to(roomChannel(roomId)).emit('confession_room_expired', { roomId });
        io.to(roomChannel(roomId)).emit('confession_room_members_updated', {
            roomId,
            members: []
        });
    });

    confessionService.emitter.on('confession_room_joined', ({ roomId, currentUserCount }) => {
        io.to(roomChannel(roomId)).emit('confession_room_stats', { roomId, currentUserCount });
        emitRoomMembersSnapshot(io, roomId);
    });

    confessionService.emitter.on('confession_room_left', ({ roomId, currentUserCount }) => {
        io.to(roomChannel(roomId)).emit('confession_room_stats', { roomId, currentUserCount });
        emitRoomMembersSnapshot(io, roomId);
    });

    confessionService.emitter.on('confession_room_member_shuffled', ({ roomId, userId, oldAlias, newAlias }) => {
        io.to(roomChannel(roomId)).emit('confession_room_member_shuffled', { roomId, userId, oldAlias, newAlias });
        emitRoomMembersSnapshot(io, roomId);
    });

    confessionService.emitter.on('confession_scheduled_fired', ({ userId, confessionId, roomId, content, scheduledAt, confirmExpiresAt }) => {
        const { getOnlineUsers } = require('../utils/socket');
        const onlineUsers = getOnlineUsers();
        const sockets = onlineUsers.get(Number(userId));
        if (!sockets) return;
        for (const sid of sockets) {
            io.to(sid).emit('confession_scheduled_ready', {
                confessionId,
                roomId,
                content,
                scheduledAt,
                confirmExpiresAt
            });
        }
    });
}

function registerConfessionSocket(io) {
    wireServiceEmitter(io);

    io.on('connection', (socket) => {
        const userId = socket.user && socket.user.userId;
        if (!userId) return;

        socket.on('confession_subscribe', async (data, callback) => {
            const safeCallback = typeof callback === 'function' ? callback : () => { };
            try {
                const parsed = roomSchema.safeParse(data);
                if (!parsed.success) return safeCallback({ ok: false, error: 'Invalid payload' });

                const { roomId } = parsed.data;
                const allowed = await ensureMembership(userId, roomId);
                if (!allowed) return safeCallback({ ok: false, error: 'Join room first' });

                socket.join(roomChannel(roomId));
                await confessionService.touchMemberActivity({ userId, roomId });
                return safeCallback({ ok: true });
            } catch (err) {
                return safeCallback({ ok: false, error: 'Failed to subscribe' });
            }
        });

        socket.on('confession_unsubscribe', (data, callback) => {
            const safeCallback = typeof callback === 'function' ? callback : () => { };
            const parsed = roomSchema.safeParse(data);
            if (!parsed.success) return safeCallback({ ok: false, error: 'Invalid payload' });

            socket.leave(roomChannel(parsed.data.roomId));
            return safeCallback({ ok: true });
        });

        socket.on('confession_post', async (data, callback) => {
            const safeCallback = typeof callback === 'function' ? callback : () => { };
            try {
                const parsed = postSchema.safeParse(data);
                if (!parsed.success) return safeCallback({ ok: false, error: 'Invalid payload' });

                const result = await confessionService.postConfession({
                    userId,
                    roomId: parsed.data.roomId,
                    content: parsed.data.content,
                    scheduledAt: parsed.data.scheduledAt || null
                });
                return safeCallback({ ok: true, ...result });
            } catch (err) {
                if (Number.isFinite(err && err.retryAfterSec)) {
                    return safeCallback({ ok: false, error: err.message, retryAfterSec: err.retryAfterSec });
                }
                return safeCallback({ ok: false, error: err && err.message ? err.message : 'Failed to post confession' });
            }
        });

        socket.on('confession_reply', async (data, callback) => {
            const safeCallback = typeof callback === 'function' ? callback : () => { };
            try {
                const parsed = replySchema.safeParse(data);
                if (!parsed.success) return safeCallback({ ok: false, error: 'Invalid payload' });

                const result = await confessionService.postReply({
                    userId,
                    roomId: parsed.data.roomId,
                    confessionId: parsed.data.confessionId,
                    content: parsed.data.content
                });
                return safeCallback({ ok: true, ...result });
            } catch (err) {
                if (Number.isFinite(err && err.retryAfterSec)) {
                    return safeCallback({ ok: false, error: err.message, retryAfterSec: err.retryAfterSec });
                }
                return safeCallback({ ok: false, error: err && err.message ? err.message : 'Failed to post reply' });
            }
        });

        socket.on('confession_react', async (data, callback) => {
            const safeCallback = typeof callback === 'function' ? callback : () => { };
            try {
                const parsed = reactSchema.safeParse(data);
                if (!parsed.success) return safeCallback({ ok: false, error: 'Invalid payload' });

                const result = await confessionService.reactToTarget({
                    userId,
                    roomId: parsed.data.roomId,
                    targetType: parsed.data.targetType,
                    targetId: parsed.data.targetId,
                    reactionType: parsed.data.reactionType
                });
                return safeCallback({ ok: true, ...result });
            } catch (err) {
                if (Number.isFinite(err && err.retryAfterSec)) {
                    return safeCallback({ ok: false, error: err.message, retryAfterSec: err.retryAfterSec });
                }
                return safeCallback({ ok: false, error: err && err.message ? err.message : 'Failed to react' });
            }
        });

        socket.on('confession_presence_ping', async (data) => {
            const parsed = roomSchema.safeParse(data);
            if (!parsed.success) return;
            try {
                await confessionService.touchMemberActivity({ userId, roomId: parsed.data.roomId });
            } catch (err) {
                // no-op
            }
        });
    });
}

module.exports = {
    registerConfessionSocket
};
