import { describe, it, expect } from 'vitest';
const { sendMessageSchema } = require('./message.validator');

describe('message.validator Zod schemas', () => {
    describe('sendMessageSchema', () => {
        it('accepts valid message with positive conversationId and content', () => {
            const valid = {
                conversationId: 101,
                content: 'Hello, how are you today?',
                clientMessageId: 'client-msg-12345678'
            };
            const result = sendMessageSchema.safeParse(valid);
            expect(result.success).toBe(true);
            expect(result.data.conversationId).toBe(101);
            expect(result.data.content).toBe('Hello, how are you today?');
        });

        it('rejects message with non-positive or missing conversationId', () => {
            expect(sendMessageSchema.safeParse({ conversationId: 0, content: 'Hi' }).success).toBe(false);
            expect(sendMessageSchema.safeParse({ conversationId: -1, content: 'Hi' }).success).toBe(false);
            expect(sendMessageSchema.safeParse({ content: 'Hi' }).success).toBe(false);
        });

        it('rejects empty content or content exceeding 5000 characters', () => {
            expect(sendMessageSchema.safeParse({ conversationId: 1, content: '' }).success).toBe(false);
            expect(sendMessageSchema.safeParse({ conversationId: 1, content: 'a'.repeat(5001) }).success).toBe(false);
        });

        it('validates clientMessageId length constraints (8-64 chars) when provided', () => {
            expect(sendMessageSchema.safeParse({
                conversationId: 1,
                content: 'Test',
                clientMessageId: 'short'
            }).success).toBe(false);

            expect(sendMessageSchema.safeParse({
                conversationId: 1,
                content: 'Test',
                clientMessageId: 'valid-client-id-12345'
            }).success).toBe(true);
        });
    });
});
