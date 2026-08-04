const { z } = require("zod");

exports.createDMSchema = z.object({
    targetUserId: z.number().int().positive()
});

exports.endConnectionSchema = z.object({
    closingNoteId: z.string().trim().min(1).max(40).nullable().optional()
});

exports.reportConnectionSchema = z.object({
    reason: z.string().trim().max(500).optional().default('')
});
