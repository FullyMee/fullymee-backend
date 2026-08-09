require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const crypto = require('crypto');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const ConfessionRoom = require('../src/models/confessionRoom.model');
const ConfessionRoomMember = require('../src/models/confessionRoomMember.model');
const ConfessionPost = require('../src/models/confessionPost.model');
const { getNextSequence, setSequenceAtLeast } = require('../src/utils/sequence');

const ROOM_DATA = [
    // --- Category: Late Night (13 rooms) ---
    { category: "Late Night", title: "Midnight Monologues", description: "Sharing thoughts under the cover of darkness.", confession: "Sometimes the quietest hours are when my mind is the loudest." },
    { category: "Late Night", title: "3 AM Realizations", description: "Deep thoughts when the world is asleep.", confession: "I realized tonight that I've been holding onto things that no longer matter." },
    { category: "Late Night", title: "Insomnia Club", description: "For everyone wide awake at midnight.", confession: "Staring at the ceiling again, wishing I could turn off my brain." },
    { category: "Late Night", title: "Silent Stars", description: "Stargazing and deep midnight talks.", confession: "The night sky always reminds me how small our biggest problems really are." },
    { category: "Late Night", title: "Night Owl Sanctuary", description: "A quiet space for nighttime musings.", confession: "Nighttime is the only time I feel truly at peace with myself." },
    { category: "Late Night", title: "Deep Night Debates", description: "Philosophical thoughts after midnight.", confession: "What if the choices we regret most were actually necessary for who we are today?" },
    { category: "Late Night", title: "Overthinking After Hours", description: "Replaying past scenarios in the dark.", confession: "I still replay a conversation from three years ago and think about what I should have said." },
    { category: "Late Night", title: "Moonlit Musings", description: "Gentle thoughts for late hours.", confession: "There is a strange comfort in knowing millions of people are awake under the same moon." },
    { category: "Late Night", title: "Stargazers Corner", description: "Looking up and opening up.", confession: "I miss the person I used to be before I learned to guard my heart so heavily." },
    { category: "Late Night", title: "The Midnight Shift", description: "Late workers and night wanderers.", confession: "Working the night shift makes you realize how peaceful the world can be." },
    { category: "Late Night", title: "Dark Room Echoes", description: "Unfiltered truths in the dark.", confession: "I pretended to be okay all day today just so no one would ask." },
    { category: "Late Night", title: "Whispers in the Dark", description: "Soft confessions for quiet nights.", confession: "I hope someone, somewhere is thinking about me tonight." },
    { category: "Late Night", title: "Late Night Haven", description: "Your midnight safe space.", confession: "Finding this space feels like finding a warm light in the middle of a cold night." },

    // --- Category: Heartbreak (13 rooms) ---
    { category: "Heartbreak", title: "Broken Pieces", description: "Picking up the pieces after love leaves.", confession: "The hardest part isn't losing them, it's losing who I was when I was with them." },
    { category: "Heartbreak", title: "Healing Wounds", description: "Taking it one day at a time.", confession: "Healing isn't linear. Some days I feel fine, and other days it feels like day one again." },
    { category: "Heartbreak", title: "Unspoken Goodbyes", description: "For words left unsaid.", confession: "I never got to say goodbye properly, and that silence is still heavy on my chest." },
    { category: "Heartbreak", title: "Heartache Lounge", description: "A shoulder to lean on.", confession: "I gave so much of myself to someone who took it for granted." },
    { category: "Heartbreak", title: "Moving On Together", description: "Rebuilding after separation.", confession: "Today was the first day I didn't check their social media. Small victory." },
    { category: "Heartbreak", title: "Silent Tears", description: "Crying in private, healing in public.", confession: "It hurts when you realize you meant so much less to them than they meant to you." },
    { category: "Heartbreak", title: "Echoes of Love", description: "Reminders of what used to be.", confession: "Hearing our song on the radio today brought back a flood of memories." },
    { category: "Heartbreak", title: "Healing Journey", description: "Finding strength through pain.", confession: "I'm learning to forgive myself for staying longer than I should have." },
    { category: "Heartbreak", title: "After the Storm", description: "Life after a major breakup.", confession: "The house feels quieter now, but slowly I'm learning to like the peace." },
    { category: "Heartbreak", title: "Letters Never Sent", description: "Drafts we'll never send.", confession: "Dear ex, I hope you find the peace you couldn't find while you were with me." },
    { category: "Heartbreak", title: "Mending Hearts", description: "Support for the heavy-hearted.", confession: "Surrounding myself with people who listen has helped me more than anything else." },
    { category: "Heartbreak", title: "Lost Connections", description: "When closeness turns to distance.", confession: "We went from talking every single day to acting like complete strangers." },
    { category: "Heartbreak", title: "Second Chances", description: "Learning to trust again.", confession: "I'm scared of getting hurt again, but I still want to believe in love." },

    // --- Category: Anxiety (12 rooms) ---
    { category: "Anxiety", title: "Calm in the Chaos", description: "Finding quiet amid inner storms.", confession: "My brain creates 50 worst-case scenarios before I even get out of bed." },
    { category: "Anxiety", title: "Breathe In Breathe Out", description: "Grounding techniques & support.", confession: "Taking 3 slow deep breaths right now because my chest feels tight." },
    { category: "Anxiety", title: "Safe Space Haven", description: "Zero judgment anxiety support.", confession: "Social gatherings drain me completely, and I felt so guilty for leaving early tonight." },
    { category: "Anxiety", title: "Overcoming Fear", description: "Facing daily anxieties step by step.", confession: "I finally made that phone call I've been avoiding for 2 weeks. Massive relief." },
    { category: "Anxiety", title: "Quiet Minds", description: "Seeking mental quietness.", confession: "I wish I could explain to people that my anxiety isn't logical, it's just overwhelming." },
    { category: "Anxiety", title: "Anxiety Support Group", description: "You are not alone in this.", confession: "Knowing other people go through the exact same feeling makes me feel less crazy." },
    { category: "Anxiety", title: "Mindful Moments", description: "Present moment awareness.", confession: "Focusing on what I can control today instead of stressing over what I can't." },
    { category: "Anxiety", title: "Unburden Your Mind", description: "Release what's weighing you down.", confession: "I carry everyone else's worries along with my own, and it's getting too heavy." },
    { category: "Anxiety", title: "Panic to Peace", description: "Navigating sudden panic moments.", confession: "Had a panic attack in my car today, but I grounded myself and got through it." },
    { category: "Anxiety", title: "Restless Thoughts", description: "Chasing peace of mind.", confession: "My mind won't stop racing about future plans that aren't even happening yet." },
    { category: "Anxiety", title: "Inner Sanctuary", description: "Protecting your energy.", confession: "Setting boundaries with people has reduced my daily anxiety by half." },
    { category: "Anxiety", title: "Peaceful Corner", description: "A calm harbor for anxious souls.", confession: "Soft music, dim lights, and a warm cup of tea — my daily anxiety antidote." },

    // --- Category: Relationships (12 rooms) ---
    { category: "Relationships", title: "Relationship Advice", description: "Honest perspectives on love.", confession: "Communication is so hard when both people are afraid of being vulnerable." },
    { category: "Relationships", title: "Love & Dynamics", description: "Exploring modern relationships.", confession: "Real love isn't butterfly excitement all the time; it's consistency and comfort." },
    { category: "Relationships", title: "Honest Dating Confessions", description: "The raw reality of modern dating.", confession: "Dating apps feel like catalog shopping for human beings. I miss organic connections." },
    { category: "Relationships", title: "Couples Corner", description: "Sharing ups and downs of partnership.", confession: "We had a huge fight last night, but we sat down and talked it through like adults." },
    { category: "Relationships", title: "Navigating Connection", description: "Deepening emotional intimacy.", confession: "I fall in love with effort and emotional availability far more than looks." },
    { category: "Relationships", title: "Crush & Confessions", description: "Secret crushes and butterflies.", confession: "I've had a crush on my best friend for 2 years and I'm terrified of ruining the friendship." },
    { category: "Relationships", title: "Communication Matters", description: "Learning to speak your truth.", confession: "Expressing my needs clearly instead of expecting my partner to guess has saved us." },
    { category: "Relationships", title: "Modern Romance", description: "Dating in the digital era.", confession: "Is it too much to ask for someone who actually calls instead of texting dryly?" },
    { category: "Relationships", title: "Friendship & Boundaries", description: "Navigating friend dynamics.", confession: "Outgrowing old friends is painful, but staying in toxic friendships is worse." },
    { category: "Relationships", title: "Relationship Realities", description: "Unfiltered truths about commitment.", confession: "Long-term relationships require choosing each other every single day." },
    { category: "Relationships", title: "Heart to Heart Talk", description: "Deep conversation space.", confession: "I just want someone I can sit in total silence with without feeling awkward." },
    { category: "Relationships", title: "Soul Connections", description: "Recognizing genuine bonds.", confession: "When you meet someone who genuinely understands your mind, hold onto them." }
];

async function seed() {
    console.log('🚀 Starting Direct 50 Rooms Seed Script...');
    await connectDB();

    // Sync sequence counters with max existing DB IDs
    const maxRoom = await ConfessionRoom.findOne().sort({ id: -1 }).select({ id: 1 }).lean();
    if (maxRoom && maxRoom.id) {
        await setSequenceAtLeast('confession_room', maxRoom.id);
    }
    const maxPost = await ConfessionPost.findOne().sort({ id: -1 }).select({ id: 1 }).lean();
    if (maxPost && maxPost.id) {
        await setSequenceAtLeast('confession_post', maxPost.id);
    }

    let user = await User.findOne().sort({ id: 1 }).lean();
    if (!user) {
        user = await User.create({ id: 1, username: 'demo_user' });
        console.log('Created demo user with ID:', user.id);
    } else {
        console.log(`Using existing user: ID ${user.id} (${user.username || 'anonymous'})`);
    }

    const userId = user.id;
    let joinedCount = 0;
    let unjoinedCount = 0;

    for (let i = 0; i < ROOM_DATA.length; i++) {
        const item = ROOM_DATA[i];
        const shouldKeepJoined = i < 25; // First 25 joined, remaining 25 unjoined
        const categoryKey = item.category.toLowerCase().replace(/\s+/g, '_');
        const titleSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const roomFamilyKey = `public:${categoryKey}:${titleSlug}`;
        const shardKey = `${categoryKey}:20260808:0`;

        try {
            // Check if room with this title exists already
            let room = await ConfessionRoom.findOne({ roomFamilyKey, roomInstance: 1 });

            if (!room) {
                const roomId = await getNextSequence('confession_room');
                room = await ConfessionRoom.create({
                    id: roomId,
                    shardKey,
                    title: item.title,
                    description: item.description,
                    category: categoryKey,
                    roomFamilyKey,
                    roomInstance: 1,
                    maxCapacity: 100,
                    currentUserCount: shouldKeepJoined ? 1 : 0,
                    roomType: 'public',
                    createdByUserId: userId,
                    isActive: true
                });
            } else {
                await ConfessionRoom.updateOne(
                    { id: room.id },
                    { $set: { currentUserCount: shouldKeepJoined ? 1 : 0 } }
                );
            }

            const roomId = room.id;

            // Handle Membership
            const existingMember = await ConfessionRoomMember.findOne({ roomId, userId });
            if (shouldKeepJoined) {
                if (!existingMember) {
                    await ConfessionRoomMember.create({
                        roomId,
                        userId,
                        alias: 'Silent Listener ' + Math.floor(100 + Math.random() * 900),
                        isActive: true,
                        joinedAt: new Date(),
                        lastActiveAt: new Date()
                    });
                } else if (!existingMember.isActive) {
                    await ConfessionRoomMember.updateOne({ roomId, userId }, { $set: { isActive: true } });
                }
                joinedCount++;
            } else {
                if (existingMember) {
                    await ConfessionRoomMember.deleteOne({ roomId, userId });
                }
                unjoinedCount++;
            }

            // Create 1 Confession Post
            const existingPost = await ConfessionPost.findOne({ roomId });
            if (!existingPost) {
                const postId = await getNextSequence('confession_post');
                const contentHash = crypto.createHash('sha256').update(item.confession.trim()).digest('hex');
                await ConfessionPost.create({
                    id: postId,
                    shardKey,
                    roomId,
                    alias: 'Wanderer ' + Math.floor(100 + Math.random() * 900),
                    content: item.confession,
                    contentHash,
                    author: userId,
                    moderationStatus: 'approved',
                    isPublished: true,
                    createdAt: new Date()
                });
            }

            const statusLabel = shouldKeepJoined ? 'Kept Joined' : 'Unjoined (Public)';
            console.log(`[${i + 1}/50] "${item.title}" (${item.category}) ➔ ${statusLabel}`);
        } catch (err) {
            console.error(`❌ Failed room [${i + 1}]: "${item.title}":`, err.message);
        }
    }

    console.log('\n========================================');
    console.log(`✅ Direct Seeding Complete!`);
    console.log(`- Total Rooms Configured: ${ROOM_DATA.length}`);
    console.log(`- Rooms Joined by User: ${joinedCount}`);
    console.log(`- Rooms Unjoined (Discoverable in Search/Home): ${unjoinedCount}`);
    console.log('========================================\n');

    process.exit(0);
}

seed().catch((err) => {
    console.error('Fatal Seed Error:', err);
    process.exit(1);
});
