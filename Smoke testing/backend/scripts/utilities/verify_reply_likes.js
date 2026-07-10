require('dotenv').config();
const { connectDB } = require('../src/config/db');
const ConfessionReply = require('../src/models/confessionReply.model');
const ReplyLike = require('../src/models/replyLike.model');
const User = require('../src/models/user.model');
const ConfessionRoom = require('../src/models/confessionRoom.model');
const ConfessionRoomMember = require('../src/models/confessionRoomMember.model');
const likeService = require('../src/services/like.service');
const confessionService = require('../src/services/confession.service');

async function main() {
    console.log('Connecting to database...');
    await connectDB();
    console.log('Database connected successfully!');

    // 1. Create a test user if none exists
    let testUser = await User.findOne({ id: 99999 });
    if (!testUser) {
        testUser = await User.create({
            id: 99999,
            username: 'like_test_user',
            email: 'liketest@example.com'
        });
        console.log('Test user created:', testUser.username);
    } else {
        console.log('Test user found:', testUser.username);
    }

    // 2. Create mock room and mock room member
    const testRoomId = 99999;
    let room = await ConfessionRoom.findOne({ id: testRoomId });
    if (!room) {
        room = await ConfessionRoom.create({
            id: testRoomId,
            shardKey: 'general:20260620:0',
            title: 'Test Room',
            category: 'test',
            roomFamilyKey: 'test-room-family',
            roomInstance: 1,
            maxCapacity: 50,
            createdByUserId: testUser.id,
            isActive: true
        });
        console.log('Test room created.');
    }

    let member = await ConfessionRoomMember.findOne({ roomId: testRoomId, userId: testUser.id });
    if (!member) {
        member = await ConfessionRoomMember.create({
            roomId: testRoomId,
            userId: testUser.id,
            alias: 'like_test_user',
            isActive: true
        });
        console.log('Test room member created.');
    } else if (!member.isActive) {
        member.isActive = true;
        await member.save();
        console.log('Test room member activated.');
    }

    // 3. Create a test reply
    const reply = await likeService.createReply({
        content: 'Verification reply ' + Date.now(),
        userId: testUser.id,
        confessionId: 10001, // Mock confession ID
        roomId: testRoomId
    });
    console.log('Test reply created. ID:', reply._id, 'Numeric ID:', reply.id);

    // 4. Test Liking the reply
    console.log('Testing reply like toggle (1)...');
    let res = await likeService.toggleLikeReply({
        replyId: reply._id,
        userId: testUser.id
    });
    console.log('Toggle 1 result:', res);
    if (!res.liked || res.likesCount !== 1) {
        throw new Error('Toggle 1 failed: expected liked=true, likesCount=1');
    }

    // Check count in DB
    let dbReply = await ConfessionReply.findById(reply._id);
    console.log('DB Reply Likes count after Toggle 1:', dbReply.likesCount);
    if (dbReply.likesCount !== 1) {
        throw new Error('Count in DB does not match');
    }

    // Check ReplyLike entry exists
    const likeDoc = await ReplyLike.findOne({ replyId: reply._id, userId: testUser.id });
    if (!likeDoc) {
        throw new Error('ReplyLike document was not created');
    }
    console.log('ReplyLike document verified:', likeDoc._id);

    // 5. Test duplicate prevention / toggle unlike
    console.log('Testing toggling same reply like (should unlike)...');
    res = await likeService.toggleLikeReply({
        replyId: reply._id,
        userId: testUser.id
    });
    console.log('Toggle 2 result (Unlike):', res);
    if (res.liked || res.likesCount !== 0) {
        throw new Error('Toggle 2 failed: expected liked=false, likesCount=0');
    }

    dbReply = await ConfessionReply.findById(reply._id);
    console.log('DB Reply Likes count after Toggle 2:', dbReply.likesCount);
    if (dbReply.likesCount !== 0) {
        throw new Error('Count in DB does not match');
    }

    // 6. Test concurrent requests (simulate race condition)
    console.log('Testing concurrent like actions on reply...');
    // Like it first so it starts at 1
    await likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });
    
    // Trigger two unlike triggers in parallel
    const p1 = likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });
    const p2 = likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });
    
    const results = await Promise.allSettled([p1, p2]);
    console.log('Concurrent results:', results.map(r => r.status === 'fulfilled' ? r.value : r.reason));
    
    dbReply = await ConfessionReply.findById(reply._id);
    console.log('DB Reply Likes count after concurrent actions:', dbReply.likesCount);
    
    // Ensure likeCount never drops below 0
    console.log('Testing negative count prevention...');
    // Clear likes first
    await ReplyLike.deleteMany({ replyId: reply._id });
    await ConfessionReply.updateOne({ _id: reply._id }, { $set: { likesCount: 0, reactionCount: 0 } });

    // Verify toggle unlike doesn't drop count below 0
    res = await likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });
    console.log('Liking first:', res);
    res = await likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });
    console.log('Unliking first time:', res);
    
    // Explicitly decrementing again or performing toggle when no like doc exists should just toggle to like
    // Let's ensure the count didn't break.
    dbReply = await ConfessionReply.findById(reply._id);
    console.log('Final DB Reply Likes count:', dbReply.likesCount);
    if (dbReply.likesCount < 0) {
        throw new Error('Count dropped below 0');
    }

    // 7. Verify view state/retrieval in listReplies via confessionService
    console.log('Testing reply viewer state mapping...');
    // Let's like it first
    await likeService.toggleLikeReply({ replyId: reply._id, userId: testUser.id });

    // Fetch replies using confessionService listReplies
    const list = await confessionService.listReplies({
        userId: testUser.id,
        roomId: testRoomId,
        confessionId: 10001
    });
    console.log('List replies output:', list);
    const checkedReply = list.find(r => r.replyId === reply.id);
    if (!checkedReply) {
        throw new Error('Created reply not found in listReplies');
    }
    console.log('Checked reply fields:', {
        likesCount: checkedReply.likesCount,
        reactionCount: checkedReply.reactionCount,
        likedByViewer: checkedReply.likedByViewer
    });
    if (!checkedReply.likedByViewer || checkedReply.reactionCount !== 1) {
        throw new Error('Viewer state mapping failed or count incorrect in listReplies');
    }

    // 8. Cleanup
    await ReplyLike.deleteMany({ replyId: reply._id });
    await ConfessionReply.deleteMany({ roomId: testRoomId });
    await ConfessionRoomMember.deleteOne({ _id: member._id });
    await ConfessionRoom.deleteOne({ _id: room._id });
    console.log('Cleanup completed. Reply Like Verification SUCCESSFUL!');
    process.exit(0);
}

main().catch(err => {
    console.error('Reply Verification FAILED:', err);
    process.exit(1);
});
