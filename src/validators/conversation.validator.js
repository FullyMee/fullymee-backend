const { z } = require("zod");

exports.createDMSchema = z.object({
    targetUserId: z.number().int().positive()
});