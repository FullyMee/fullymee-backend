const { z } = require('zod');

exports.joinRoomSchema = z.object({
    roomId: z.coerce.number().int().positive().optional(),
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    category: z.string().trim().min(1).max(50).optional(),
    roomType: z.enum(['public', 'private', 'timed']).optional(),
    maxCapacity: z.coerce.number().int().min(2).max(500).optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    expiresAt: z.coerce.date().optional(),
    joinSource: z.string().trim().min(1).max(40).optional()
});

exports.createRoomSchema = z.object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().min(1).max(50).nullable().optional(),
    roomType: z.enum(['public', 'private']),
    joinCode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6 digit code').nullable().optional(),
    ambienceId: z.string().trim().min(1).max(80).nullable().optional()
});

exports.joinRoomByCodeSchema = z.object({
    code: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6 digit code'),
    joinSource: z.string().trim().min(1).max(40).optional()
});

exports.postConfessionSchema = z.object({
    content: z.string().trim().min(1, 'Confession content or audio title is required').max(200),
    scheduledAt: z.string().datetime().optional(),
    audioPublicId: z.string().trim().min(1).max(240).optional(),
    audioDuration: z.coerce.number().min(1).max(30).optional()
});

exports.postReplySchema = z.object({
    content: z.string().trim().min(1).max(1500),
    parentReplyId: z.coerce.number().int().positive().nullable().optional(),
    parentAlias: z.string().trim().max(40).nullable().optional()
});

exports.reactSchema = z.object({
    targetType: z.enum(['confession', 'reply']),
    targetId: z.coerce.number().int().positive(),
    reactionType: z.enum(['support', 'empathy', 'agree', 'insight', 'heart'])
});

exports.reportSchema = z.object({
    targetType: z.enum(['confession', 'reply']),
    targetId: z.coerce.number().int().positive(),
    reason: z.string().trim().min(3).max(280)
});

exports.roomIdParamsSchema = z.object({
    roomId: z.coerce.number().int().positive()
});

exports.confessionIdParamsSchema = z.object({
    confessionId: z.coerce.number().int().positive()
});

exports.listQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    sortBy: z.enum(['ranked', 'latest', 'top']).optional()
});

exports.recommendationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(10).optional(),
    roomType: z.enum(['public', 'timed']).optional()
});

exports.publicRoomQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    sortBy: z.enum(['discover', 'trending']).optional(),
    search: z.string().trim().max(120).optional()
});

exports.analyticsQuerySchema = z.object({
    roomId: z.coerce.number().int().positive(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
});

exports.moderationQueueQuerySchema = z.object({
    status: z.enum(['pending', 'reviewing', 'resolved', 'all']).optional(),
    severity: z.enum(['green', 'yellow', 'red', 'all']).optional(),
    targetType: z.enum(['confession', 'reply', 'room', 'system', 'all']).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional()
});

exports.moderationQueueIdParamsSchema = z.object({
    queueId: z.coerce.number().int().positive()
});

exports.resolveModerationSchema = z.object({
    action: z.enum(['approve', 'hide', 'block', 'dismiss']),
    reason: z.string().trim().min(3).max(500).optional()
});
