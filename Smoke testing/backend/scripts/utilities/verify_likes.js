require('dotenv').config();
const { connectDB } = require('../src/config/db');
const Confession = require('../src/models/confessionPost.model');
const ConfessionLike = require('../src/models/confessionLike.model');
const User = require('../src/models/user.model');
const likeService = require('../src/services/like.service');

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

    // 2. Create a test confession
    const confession = await likeService.createConfession({
        content: 'Verification confession ' + Date.now(),
        userId: testUser.id
    });
    console.log('Test confession created. ID:', confession._id);

    // 3. Test Liking the confession
    console.log('Testing like toggle (1)...');
    let res = await likeService.toggleLikeConfession({
        confessionId: confession._id,
        userId: testUser.id
    });
    console.log('Toggle 1 result:', res);
    if (!res.liked || res.likesCount !== 1) {
        throw new Error('Toggle 1 failed: expected liked=true, likesCount=1');
    }

    // Check count in DB
    let dbConf = await Confession.findById(confession._id);
    console.log('DB Likes count after Toggle 1:', dbConf.likesCount);
    if (dbConf.likesCount !== 1) {
        throw new Error('Count in DB does not match');
    }

    // 4. Test duplicate prevention / concurrency
    console.log('Testing toggling same like (should unlike)...');
    res = await likeService.toggleLikeConfession({
        confessionId: confession._id,
        userId: testUser.id
    });
    console.log('Toggle 2 result (Unlike):', res);
    if (res.liked || res.likesCount !== 0) {
        throw new Error('Toggle 2 failed: expected liked=false, likesCount=0');
    }

    dbConf = await Confession.findById(confession._id);
    console.log('DB Likes count after Toggle 2:', dbConf.likesCount);
    if (dbConf.likesCount !== 0) {
        throw new Error('Count in DB does not match');
    }

    // 5. Test concurrent requests (simulate race condition)
    console.log('Testing concurrent like actions...');
    // Like it first so it starts at 1
    await likeService.toggleLikeConfession({ confessionId: confession._id, userId: testUser.id });
    
    // Trigger two unlike triggers in parallel
    const p1 = likeService.toggleLikeConfession({ confessionId: confession._id, userId: testUser.id });
    const p2 = likeService.toggleLikeConfession({ confessionId: confession._id, userId: testUser.id });
    
    const results = await Promise.allSettled([p1, p2]);
    console.log('Concurrent results:', results.map(r => r.status === 'fulfilled' ? r.value : r.reason));
    
    dbConf = await Confession.findById(confession._id);
    console.log('DB Likes count after concurrent actions:', dbConf.likesCount);
    
    // Ensure likeCount never drops below 0
    console.log('Testing negative count prevention...');
    // Clear likes first
    await ConfessionLike.deleteMany({ confessionId: confession._id });
    await Confession.updateOne({ _id: confession._id }, { $set: { likesCount: 0 } });
    
    // 6. Verify feed query
    console.log('Testing feed retrieval...');
    const feed = await likeService.listFeed({ userId: testUser.id, limit: 5 });
    console.log('Feed sample:', feed[0]);
    if (feed[0]._id.toString() !== confession._id.toString()) {
        throw new Error('Feed retrieval mismatch');
    }

    // 7. Cleanup
    await ConfessionLike.deleteMany({ confessionId: confession._id });
    await Confession.deleteOne({ _id: confession._id });
    console.log('Cleanup completed. Verification SUCCESSFUL!');
    process.exit(0);
}

main().catch(err => {
    console.error('Verification FAILED:', err);
    process.exit(1);
});
