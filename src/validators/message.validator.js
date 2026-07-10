const { z } = require("zod");

exports.sendMessageSchema = z.object({
    conversationId: z.number().int().positive(),
    content: z.string().min(1).max(5000),
    clientMessageId: z.string().min(8).max(64).optional()
});