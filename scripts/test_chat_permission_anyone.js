require('dotenv').config();
const { connectDB, mongoose } = require('../src/config/db');
const User = require('../src/models/user.model');
const ChatRequest = require('../src/models/chatRequest.model');
const conversationService = require('../src/services/conversation.service');

async function testAnyoneChatPermission() {
    console.log('--- STARTING CHAT PERMISSION "ANYONE" INTEGRATION TEST ---');
    await connectDB();

    const userAId = 999101;
    const userBId = 999102;

    try {
        // Clean up any previous test artifacts
        await User.deleteMany({ id: { $in: [userAId, userBId] } });
        await ChatRequest.deleteMany({ $or: [{ requesterUserId: userBId }, { targetUserId: userAId }] });

        // Create User A (Target) and User B (Requester)
        await User.create({
            id: userAId,
            username: `test_user_a_${Date.now()}`,
            email: `test_user_a_${Date.now()}@example.com`,
            preferences: { chatRequestPermission: 'anyone' }
        });

        await User.create({
            id: userBId,
            username: `test_user_b_${Date.now()}`,
            email: `test_user_b_${Date.now()}@example.com`,
            preferences: { chatRequestPermission: 'rooms' }
        });

        // 1. TEST PERMISSION = 'anyone' (Zero Shared Rooms)
        console.log('\n[Test 1] Testing chat request when target has chatRequestPermission = "anyone"...');
        const resAnyone = await conversationService.createChatRequest({
            requesterUserId: userBId,
            targetUserId: userAId,
            contextType: 'profile'
        });

        if (resAnyone && (resAnyone.status === 'pending' || resAnyone.status === 'accepted')) {
            console.log('PASS [Test 1]: Chat request successfully created for target with "anyone" permission without shared rooms.');
        } else {
            console.error('FAIL [Test 1]: Unexpected result for "anyone":', resAnyone);
            process.exit(1);
        }

        // Cleanup the created request
        await ChatRequest.deleteMany({ requesterUserId: userBId, targetUserId: userAId });

        // 2. TEST PERMISSION = 'rooms' (Zero Shared Rooms)
        console.log('\n[Test 2] Testing chat request when target has chatRequestPermission = "rooms"...');
        await User.updateOne({ id: userAId }, { $set: { 'preferences.chatRequestPermission': 'rooms' } });

        try {
            await conversationService.createChatRequest({
                requesterUserId: userBId,
                targetUserId: userAId,
                contextType: 'profile'
            });
            console.error('FAIL [Test 2]: Expected request to fail with "rooms" permission and 0 shared rooms, but it succeeded!');
            process.exit(1);
        } catch (err) {
            if (err.code === 'CHAT_REQUEST_TARGET_NOT_IN_ROOM' || err.code === 'CHAT_REQUEST_NO_SHARED_ROOM') {
                console.log(`PASS [Test 2]: Correctly blocked request for "rooms" permission (${err.code}: ${err.message})`);
            } else {
                console.error('FAIL [Test 2]: Unexpected error code:', err);
                process.exit(1);
            }
        }

        // 3. TEST PERMISSION = 'nobody'
        console.log('\n[Test 3] Testing chat request when target has chatRequestPermission = "nobody"...');
        await User.updateOne({ id: userAId }, { $set: { 'preferences.chatRequestPermission': 'nobody' } });

        try {
            await conversationService.createChatRequest({
                requesterUserId: userBId,
                targetUserId: userAId,
                contextType: 'profile'
            });
            console.error('FAIL [Test 3]: Expected request to fail with "nobody" permission, but it succeeded!');
            process.exit(1);
        } catch (err) {
            if (err.code === 'CHAT_REQUESTS_DISABLED') {
                console.log(`PASS [Test 3]: Correctly blocked request for "nobody" permission (${err.code}: ${err.message})`);
            } else {
                console.error('FAIL [Test 3]: Unexpected error code:', err);
                process.exit(1);
            }
        }

        // Cleanup
        await User.deleteMany({ id: { $in: [userAId, userBId] } });
        await ChatRequest.deleteMany({ $or: [{ requesterUserId: userBId }, { targetUserId: userAId }] });

        console.log('\n--- ALL CHAT PERMISSION "ANYONE" TESTS PASSED PERFECTLY! ---');
    } finally {
        await mongoose.connection.close();
    }
}

testAnyoneChatPermission().catch((err) => {
    console.error('Test execution failed:', err);
    process.exit(1);
});
