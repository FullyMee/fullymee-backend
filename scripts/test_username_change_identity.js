require('dotenv').config();
const assert = require('assert');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const ConfessionPost = require('../src/models/confessionPost.model');
const ConfessionReply = require('../src/models/confessionReply.model');
const ConfessionRoom = require('../src/models/confessionRoom.model');
const ConfessionRoomMember = require('../src/models/confessionRoomMember.model');
const confessionService = require('../src/services/confession.service');

async function runTests() {
    console.log('=== STARTING USERNAME CHANGE & IMMUTABLE USER ID IDENTITY TESTS ===');
    try {
        await connectDB();
        console.log('Connected to MongoDB.');

        const timestamp = Date.now();
        const user1Id = 999100 + Math.floor(Math.random() * 1000);
        const user2Id = 999200 + Math.floor(Math.random() * 1000);
        const roomId = 999300 + Math.floor(Math.random() * 1000);

        const oldUsername = `cosmic.dolphin${timestamp % 10000}`;
        const newUsername = `bright.panda${timestamp % 10000}`;
        const thirdUsername = `silent.falcon${timestamp % 10000}`;
        const otherUsername = `quiet.owl${timestamp % 10000}`;

        try {
            // 1. Setup Test Room
            await ConfessionRoom.create({
                id: roomId,
                shardKey: 'general:2026-08',
                roomFamilyKey: `test-identity-room-${roomId}`,
                roomInstance: 1,
                title: 'Test Identity Room',
                category: 'general',
                maxCapacity: 50,
                currentUserCount: 2,
                isActive: true,
                roomType: 'public'
            });
            console.log('Room created.');

            // 2. Setup User 1 with initial username
            await User.create({
                id: user1Id,
                username: oldUsername,
                email: `user1_${timestamp}@test.com`,
                preferences: { avatar: 'flowing_waterfall' }
            });
            console.log('User 1 created.');

            // User 1 joins room
            await confessionService.joinRoom({ userId: user1Id, roomId });
            console.log('User 1 joined room.');

            // 3. User 1 creates Confession 1
            console.log('\n[TEST 1] Creating Confession 1 under initial username:', oldUsername);
            const post1Result = await confessionService.postConfession({
                userId: user1Id,
                roomId,
                content: 'Late night thoughts 🌌✨🧘 #mindfulness'
            });
            const confession1Id = post1Result.confession.confessionId;
            const initialCreatedAt = post1Result.confession.createdAt;

            // Verify post in database has author = user1Id
            const dbPost1 = await ConfessionPost.findOne({ id: confession1Id }).lean();
            assert.strictEqual(Number(dbPost1.author), user1Id, 'Confession author must equal User 1 ID');
            console.log('  ✓ Post 1 created with authorId:', dbPost1.author);

            // 4. User 1 creates a reply
            console.log('\n[TEST 2] Creating Reply 1 under initial username');
            const replyResult = await confessionService.postReply({
                userId: user1Id,
                roomId,
                confessionId: confession1Id,
                content: 'I completely agree with this.'
            });
            const reply1Id = replyResult.reply.replyId;

            // 5. Verify initial feed displays oldUsername
            console.log('\n[TEST 3] Verifying initial confession list returns old username');
            let confessions = await confessionService.listConfessions({ userId: user1Id, roomId });
            let targetConfession = confessions.find(c => c.confessionId === confession1Id);
            assert.strictEqual(targetConfession.alias, oldUsername, 'Initial confession should show initial username');
            console.log('  ✓ Confession 1 displays alias:', targetConfession.alias);

            let myConfessions = await confessionService.listMyConfessions({ userId: user1Id });
            let myTarget = myConfessions.find(c => c.confessionId === confession1Id);
            assert.ok(myTarget, 'Confession 1 must be found in listMyConfessions');
            assert.strictEqual(myTarget.alias, oldUsername);
            console.log('  ✓ listMyConfessions displays alias:', myTarget.alias);

            // 6. User 1 changes username to newUsername
            console.log(`\n[TEST 4] Updating User 1 username: ${oldUsername} -> ${newUsername}`);
            await User.updateOne({ id: user1Id }, { $set: { username: newUsername } });
            await ConfessionRoomMember.updateMany({ userId: user1Id }, { $set: { alias: newUsername } });

            // 7. Verify Confession 1 immediately returns newUsername without modifying post record
            console.log('\n[TEST 5] Verifying Confession 1 now displays NEW username');
            confessions = await confessionService.listConfessions({ userId: user1Id, roomId });
            targetConfession = confessions.find(c => c.confessionId === confession1Id);
            assert.strictEqual(targetConfession.alias, newUsername, `Confession 1 must now display ${newUsername}`);
            assert.strictEqual(targetConfession.content, 'Late night thoughts 🌌✨🧘 #mindfulness', 'Content must be unchanged');
            assert.strictEqual(new Date(targetConfession.createdAt).getTime(), new Date(initialCreatedAt).getTime(), 'CreatedAt must be unchanged');
            console.log('  ✓ Confession 1 dynamically displays new alias:', targetConfession.alias);
            console.log('  ✓ Post ID, CreatedAt, and Content remain identical.');

            // 8. Verify replies also display newUsername
            console.log('\n[TEST 6] Verifying Reply 1 now displays NEW username');
            const replies = await confessionService.listReplies({ userId: user1Id, roomId, confessionId: confession1Id });
            const targetReply = replies.find(r => r.replyId === reply1Id);
            assert.strictEqual(targetReply.alias, newUsername, `Reply 1 must display ${newUsername}`);
            console.log('  ✓ Reply 1 dynamically displays new alias:', targetReply.alias);

            // 9. Verify listMyConfessions displays newUsername
            console.log('\n[TEST 7] Verifying listMyConfessions displays NEW username');
            myConfessions = await confessionService.listMyConfessions({ userId: user1Id });
            myTarget = myConfessions.find(c => c.confessionId === confession1Id);
            assert.ok(myTarget, 'Confession 1 must be found in listMyConfessions');
            assert.strictEqual(myTarget.alias, newUsername);
            console.log('  ✓ listMyConfessions displays alias:', myTarget.alias);

            // 10. User 1 creates Confession 2 after username change
            console.log('\n[TEST 8] Creating Confession 2 after username change');
            const post2Result = await confessionService.postConfession({
                userId: user1Id,
                roomId,
                content: 'Morning reflections ☕📖'
            });
            const confession2Id = post2Result.confession.confessionId;

            confessions = await confessionService.listConfessions({ userId: user1Id, roomId });
            const c1 = confessions.find(c => c.confessionId === confession1Id);
            const c2 = confessions.find(c => c.confessionId === confession2Id);
            assert.strictEqual(c1.alias, newUsername, 'Old confession must show new username');
            assert.strictEqual(c2.alias, newUsername, 'New confession must show new username');
            console.log('  ✓ Both old and new confessions show:', newUsername);

            // 11. User 1 changes username a second time
            console.log(`\n[TEST 9] Changing username again: ${newUsername} -> ${thirdUsername}`);
            await User.updateOne({ id: user1Id }, { $set: { username: thirdUsername } });
            await ConfessionRoomMember.updateMany({ userId: user1Id }, { $set: { alias: thirdUsername } });

            confessions = await confessionService.listConfessions({ userId: user1Id, roomId });
            const updatedC1 = confessions.find(c => c.confessionId === confession1Id);
            const updatedC2 = confessions.find(c => c.confessionId === confession2Id);
            assert.strictEqual(updatedC1.alias, thirdUsername, 'Old confession must show third username');
            assert.strictEqual(updatedC2.alias, thirdUsername, 'Second confession must show third username');
            console.log('  ✓ All past confessions now display:', thirdUsername);

            // 12. Create User 2 and verify isolation
            console.log('\n[TEST 10] Verifying User 2 posts remain isolated');
            await User.create({
                id: user2Id,
                username: otherUsername,
                email: `user2_${timestamp}@test.com`
            });
            await confessionService.joinRoom({ userId: user2Id, roomId });
            const user2Post = await confessionService.postConfession({
                userId: user2Id,
                roomId,
                content: 'Hello from User 2'
            });

            confessions = await confessionService.listConfessions({ userId: user1Id, roomId });
            const cOther = confessions.find(c => c.confessionId === user2Post.confession.confessionId);
            assert.strictEqual(cOther.alias, otherUsername, 'User 2 confession must display User 2 username');
            console.log('  ✓ User 2 post displays:', cOther.alias);

            // 13. Verify Room Members list reflects current usernames
            console.log('\n[TEST 11] Verifying listRoomMembers dynamically resolves current usernames');
            const members = await confessionService.listRoomMembers({ userId: user1Id, roomId });
            const m1 = members.find(m => m.userId === user1Id);
            const m2 = members.find(m => m.userId === user2Id);
            assert.strictEqual(m1.alias, thirdUsername, `Member 1 must display ${thirdUsername}`);
            assert.strictEqual(m2.alias, otherUsername, `Member 2 must display ${otherUsername}`);
            console.log('  ✓ Room members list displays:', m1.alias, 'and', m2.alias);

            console.log('\n======================================================');
            console.log('🎉 ALL 11 TESTS PASSED SUCCESSFULLY! ARCHITECTURE VALIDATED!');
            console.log('======================================================');
        } catch (err) {
            console.error('❌ INNER TEST ERROR:', err);
            throw err;
        } finally {
            // Cleanup test data
            await ConfessionPost.deleteMany({ roomId });
            await ConfessionReply.deleteMany({ roomId });
            await ConfessionRoomMember.deleteMany({ roomId });
            await ConfessionRoom.deleteOne({ id: roomId });
            await User.deleteMany({ id: { $in: [user1Id, user2Id] } });
        }
    } catch (err) {
        console.error('❌ TOP LEVEL ERROR:', err);
        process.exit(1);
    }
}

runTests();
