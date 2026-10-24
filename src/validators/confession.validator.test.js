import { describe, it, expect } from 'vitest';
const {
    joinRoomSchema,
    createRoomSchema,
    joinRoomByCodeSchema,
    postConfessionSchema,
    postReplySchema,
    reactSchema,
    reportSchema
} = require('./confession.validator');

describe('confession.validator Zod schemas', () => {
    describe('createRoomSchema', () => {
        it('validates a correct public room creation payload', () => {
            const valid = {
                title: 'Late Night Chats',
                description: 'A cozy corner for night owls',
                category: 'late_night',
                roomType: 'public'
            };
            const result = createRoomSchema.safeParse(valid);
            expect(result.success).toBe(true);
            expect(result.data.title).toBe('Late Night Chats');
        });

        it('validates a private room with a 6-digit join code', () => {
            const valid = {
                title: 'Secret Study Circle',
                roomType: 'private',
                joinCode: '123456'
            };
            const result = createRoomSchema.safeParse(valid);
            expect(result.success).toBe(true);
            expect(result.data.joinCode).toBe('123456');
        });

        it('rejects title shorter than 3 characters or missing roomType', () => {
            expect(createRoomSchema.safeParse({ title: 'Hi', roomType: 'public' }).success).toBe(false);
            expect(createRoomSchema.safeParse({ title: 'Valid Title' }).success).toBe(false);
        });

        it('rejects invalid join code formats', () => {
            const invalidCodes = ['12345', '1234567', 'abcdef', '12 345'];
            for (const code of invalidCodes) {
                const res = createRoomSchema.safeParse({
                    title: 'Private Room',
                    roomType: 'private',
                    joinCode: code
                });
                expect(res.success).toBe(false);
            }
        });
    });

    describe('joinRoomByCodeSchema', () => {
        it('accepts valid 6-digit code', () => {
            const res = joinRoomByCodeSchema.safeParse({ code: '654321' });
            expect(res.success).toBe(true);
            expect(res.data.code).toBe('654321');
        });

        it('rejects invalid or non-6-digit codes', () => {
            expect(joinRoomByCodeSchema.safeParse({ code: '123' }).success).toBe(false);
            expect(joinRoomByCodeSchema.safeParse({ code: 'code12' }).success).toBe(false);
            expect(joinRoomByCodeSchema.safeParse({}).success).toBe(false);
        });
    });

    describe('postConfessionSchema', () => {
        it('accepts valid confession text content within limits (1-200 chars)', () => {
            const res = postConfessionSchema.safeParse({
                content: 'Sometimes you just need to let it out.'
            });
            expect(res.success).toBe(true);
        });

        it('rejects empty or over-limit content', () => {
            expect(postConfessionSchema.safeParse({ content: '' }).success).toBe(false);
            expect(postConfessionSchema.safeParse({ content: 'a'.repeat(201) }).success).toBe(false);
        });

        it('accepts valid audio attributes', () => {
            const res = postConfessionSchema.safeParse({
                content: 'Voice confession title',
                audioPublicId: 'audio/sample_123',
                audioDuration: 15
            });
            expect(res.success).toBe(true);
            expect(res.data.audioDuration).toBe(15);
        });

        it('rejects audio duration greater than 30 seconds', () => {
            const res = postConfessionSchema.safeParse({
                content: 'Voice confession',
                audioPublicId: 'audio/sample_123',
                audioDuration: 35
            });
            expect(res.success).toBe(false);
        });
    });

    describe('postReplySchema', () => {
        it('accepts reply content within 1-1500 chars', () => {
            const res = postReplySchema.safeParse({
                content: 'I understand what you are going through.',
                parentReplyId: 12
            });
            expect(res.success).toBe(true);
            expect(res.data.parentReplyId).toBe(12);
        });

        it('rejects empty reply or reply > 1500 chars', () => {
            expect(postReplySchema.safeParse({ content: '' }).success).toBe(false);
            expect(postReplySchema.safeParse({ content: 'x'.repeat(1501) }).success).toBe(false);
        });
    });

    describe('reactSchema', () => {
        it('accepts valid targetType and reactionType', () => {
            const res = reactSchema.safeParse({
                targetType: 'confession',
                targetId: 5,
                reactionType: 'support'
            });
            expect(res.success).toBe(true);
        });

        it('rejects unknown targetType or reactionType', () => {
            expect(reactSchema.safeParse({
                targetType: 'comment',
                targetId: 5,
                reactionType: 'support'
            }).success).toBe(false);

            expect(reactSchema.safeParse({
                targetType: 'confession',
                targetId: 5,
                reactionType: 'angry'
            }).success).toBe(false);
        });
    });
});
