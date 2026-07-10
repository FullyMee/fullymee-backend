const { z } = require("zod");

exports.socketMessageSchema = z.object({
    clientMessageId: z.string().min(8).max(64),
    conversationId: z.number().int().positive(),
    content: z.string().min(1).max(5000)
});

exports.markReadSchema = z.object({
    conversationId: z.number().int().positive(),
    messageId: z.number().int().positive()
});

exports.typingSchema = z.object({
    conversationId: z.number().int().positive()
});