require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const crypto = require('crypto');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const ConfessionRoom = require('../src/models/confessionRoom.model');
const ConfessionRoomMember = require('../src/models/confessionRoomMember.model');
const ConfessionPost = require('../src/models/confessionPost.model');
const { getNextSequence, setSequenceAtLeast } = require('../src/utils/sequence');

const ROOM_DATA = [
    // 1. Late Night (3 rooms)
    { category: "late_night", title: "Midnight Monologues", ambienceId: "moonlit_window", description: "Sharing unfiltered thoughts under the cover of darkness.", confession: "Sometimes the quietest hours are when my mind is the loudest." },
    { category: "late_night", title: "Neon City After Midnight", ambienceId: "neon_skyline", description: "Vibrant late-night talks for city dwellers and night owls.", confession: "Watching the neon lights flicker outside, wondering where everyone is heading." },
    { category: "late_night", title: "3 AM Rainy Thoughts", ambienceId: "rainy_midnight", description: "Deep midnight reflections as the rain taps on the window.", confession: "There is something calming about the sound of rain when the whole city is asleep." },

    // 2. Heartbreak (4 rooms)
    { category: "heartbreak", title: "Letters Left Unsent", ambienceId: "broken_letter", description: "The words we wrote down but could never bring ourselves to send.", confession: "I wrote a three-page letter today, only to delete every single line." },
    { category: "heartbreak", title: "Silent Park Memories", ambienceId: "empty_park_bench", description: "Reflecting on empty benches and moments that used to be full of warmth.", confession: "Sitting on our old bench today. The silence was louder than our arguments used to be." },
    { category: "heartbreak", title: "Autumn Healing", ambienceId: "falling_leaves", description: "Letting go of past pain like autumn leaves falling to the ground.", confession: "Healing isn't linear. Some days I feel at peace, other days it still hurts." },
    { category: "heartbreak", title: "Lonely Pier at Twilight", ambienceId: "lonely_pier", description: "Quiet ocean breeze and processing grief one wave at a time.", confession: "Looking out into the horizon, finally realizing that loving them meant losing myself." },

    // 3. Anxiety (3 rooms)
    { category: "anxiety", title: "Serene Lake Sanctuary", ambienceId: "calm_lake", description: "A gentle refuge to ground your thoughts and find inner stillness.", confession: "Taking slow deep breaths right now. Reminding myself that I am safe in this moment." },
    { category: "anxiety", title: "Cloud Nine Breathing", ambienceId: "floating_clouds", description: "Guided by soft clouds to ease overthinking and nervous tension.", confession: "My mind was racing all afternoon, but stepping outside helped clear the haze." },
    { category: "anxiety", title: "Whispering Misty Pines", ambienceId: "misty_forest", description: "Walk through tranquil misty woods and leave daily worries behind.", confession: "Setting strict boundaries with work has cut my morning panic by half." },

    // 4. Relationships (4 rooms)
    { category: "relationships", title: "Blossom Romance", ambienceId: "cherry_blossoms", description: "Heartfelt talks about love, sweet crushes, and delicate connections.", confession: "I've had a crush on my best friend for two years and I'm terrified of ruining things." },
    { category: "relationships", title: "Corner Café Chats", ambienceId: "couples_cafe", description: "Cozy coffeehouse talks on communication, trust, and companionship.", confession: "Real love isn't butterfly excitement all the time; it's consistency and comfort." },
    { category: "relationships", title: "Lantern Lit Confessions", ambienceId: "heart_lanterns", description: "Warm lantern glow for opening up about deep relationship truths.", confession: "Expressing my true needs clearly instead of staying quiet completely saved our bond." },
    { category: "relationships", title: "Golden Bridge Connections", ambienceId: "golden_bridge", description: "Bridging differences and creating lasting emotional intimacy.", confession: "When you meet someone who genuinely respects your peace, you cherish them forever." },

    // 5. College (3 rooms)
    { category: "college", title: "Campus Night Walks", ambienceId: "misty_forest", description: "Late-night strolls between dorms, exam stresses, and youthful dreams.", confession: "Finals week is draining, but the late-night library study group made me laugh so hard." },
    { category: "college", title: "Dorm Window Realities", ambienceId: "moonlit_window", description: "Life far away from home, figuring out identity and independence.", confession: "Homesickness hits hardest on Sunday evenings, but I am proud of how far I've come." },
    { category: "college", title: "Open Sky Aspirations", ambienceId: "floating_clouds", description: "Big ambitions, internship anxiety, and finding your future path.", confession: "I have no idea what my career will look like, and I am finally okay admitting that." },

    // 6. Career (3 rooms)
    { category: "career", title: "Mountain Peak Ambitions", ambienceId: "mountain_dawn", description: "Overcoming imposter syndrome and climbing the ladder with purpose.", confession: "I got promoted today! Celebrating quietly here because I worked so hard for it." },
    { category: "career", title: "The Bridge to Leadership", ambienceId: "golden_bridge", description: "Navigating workplace politics, mentorship, and career growth.", confession: "Being a leader isn't about having all answers; it's about listening to the team." },
    { category: "career", title: "Highrise Hustle & Burnout", ambienceId: "neon_skyline", description: "Honest conversations on work-life balance and preventing burnout.", confession: "Turned off Slack notifications at 6 PM sharp today. Reclaiming my evenings." },

    // 7. Tech & Coding (3 rooms)
    { category: "tech_coding", title: "Late Night Cyber Devs", ambienceId: "neon_skyline", description: "Terminal glow, system architecture, and late debugging sessions.", confession: "Spent 4 hours tracking a bug only to realize it was a missing environment variable." },
    { category: "tech_coding", title: "Midnight Code & Coffee", ambienceId: "rainy_midnight", description: "Quiet hacking, side projects, and building passion software.", confession: "Building something purely for fun again reminded me why I fell in love with coding." },
    { category: "tech_coding", title: "Aurora Algorithm Haven", ambienceId: "aurora_night", description: "AI, cloud engineering, and discussing the frontier of technology.", confession: "The pace of AI development is exhilarating, but we need to stay mindful of ethics." },

    // 8. Casual Chat (3 rooms)
    { category: "casual_chat", title: "Warm Tea & Cozy Talks", ambienceId: "couples_cafe", description: "Relaxed friendly banter about everyday life, hobbies, and fun stories.", confession: "Tried baking sourdough bread for the first time today. Total disaster, but hilarious." },
    { category: "casual_chat", title: "Golden Sunset Chills", ambienceId: "sunset_beach", description: "Golden hour relaxation where everyone is welcome to chime in.", confession: "Watching the sun go down while listening to lofi beats is the ultimate therapy." },
    { category: "casual_chat", title: "Spring Bloom Catchups", ambienceId: "cherry_blossoms", description: "Lighthearted conversations to brighten up your daily routine.", confession: "Random compliment from a barista today made my entire week." },

    // 9. Confessions (3 rooms)
    { category: "confessions", title: "Rainy Window Secrets", ambienceId: "rainy_window", description: "Unburden yourself with deepest anonymous confessions and secrets.", confession: "I pretend to be confident around everyone, but inside I constantly doubt myself." },
    { category: "confessions", title: "Unspoken Family Truths", ambienceId: "broken_letter", description: "Processing complex family dynamics and long-hidden truths.", confession: "I forgave my parents not for their sake, but so I could finally sleep peacefully." },
    { category: "confessions", title: "Midnight Shadows", ambienceId: "moonlit_window", description: "A secure void to release thoughts you cannot share anywhere else.", confession: "I let go of a toxic friendship today. It hurts, but a weight has lifted." },

    // 10. Gaming (3 rooms)
    { category: "gaming", title: "Aurora Gaming Lounge", ambienceId: "aurora_night", description: "Multiplayer stories, clutch moments, and favorite game soundtracks.", confession: "Single-player story games have moved me more emotionally than most movies." },
    { category: "gaming", title: "Cyberpunk Arena", ambienceId: "neon_skyline", description: "Competitive gaming, esports hype, and high-energy squad chats.", confession: "Finally hit Diamond rank after grinding for three months straight!" },
    { category: "gaming", title: "Starlight Co-Op Lounge", ambienceId: "northern_sky", description: "Chill co-op sessions, cozy indie games, and friendly teammates.", confession: "Playing Stardew Valley after a chaotic week is the purest form of relaxation." },

    // 11. Entertainment (3 rooms)
    { category: "entertainment", title: "Festival Lantern Vibes", ambienceId: "heart_lanterns", description: "Music festivals, concert memories, and favorite artist discoveries.", confession: "Hearing my favorite song live in concert brought genuine tears to my eyes." },
    { category: "entertainment", title: "Cinema & Neon Nights", ambienceId: "neon_skyline", description: "Deep movie analysis, plot twist breakdowns, and midnight screenings.", confession: "Rewatched Interstellar for the fifth time and the ending still gives me chills." },
    { category: "entertainment", title: "Pop Culture & Blossoms", ambienceId: "cherry_blossoms", description: "Trending shows, anime discussions, and artistic inspirations.", confession: "Studio Ghibli films always make me appreciate the tiny joys of daily life." },

    // 12. Fitness & Wellness (3 rooms)
    { category: "fitness", title: "Sunrise Summit Warriors", ambienceId: "mountain_dawn", description: "Morning workouts, hiking trails, and physical transformation milestones.", confession: "Ran my first 5k without stopping today. Six months ago I couldn't run a block." },
    { category: "fitness", title: "Mindful Lakeside Yoga", ambienceId: "calm_lake", description: "Stretching, flexibility, breathwork, and holistic wellness habits.", confession: "Practicing yoga every morning has completely resolved my chronic lower back pain." },
    { category: "fitness", title: "Floating Recovery Zone", ambienceId: "floating_clouds", description: "Rest days, healthy nutrition, and listening to your body's limits.", confession: "Learning to take rest days without feeling guilty was my biggest fitness breakthrough." },

    // 13. Finance & Crypto (3 rooms)
    { category: "finance", title: "Wall Street Bridge", ambienceId: "golden_bridge", description: "Smart investing, market trends, and navigating economic cycles.", confession: "Automating my monthly index fund contributions was the best money move I ever made." },
    { category: "finance", title: "Financial District Hub", ambienceId: "neon_skyline", description: "Budgeting discipline, debt-free journeys, and building emergency funds.", confession: "Paid off my last student loan payment this morning. Debt free at 27!" },
    { category: "finance", title: "Early Bird Wealth Building", ambienceId: "mountain_dawn", description: "Long-term compounding, financial freedom, and frugal lifestyle tips.", confession: "Real wealth isn't expensive gadgets; it's having the freedom to control your time." },

    // 14. Travel & Adventure (3 rooms)
    { category: "travel", title: "Sunset Coastline Wanderers", ambienceId: "sunset_beach", description: "Backpacking coastlines, solo travel courage, and beach sunsets.", confession: "My first solo backpacking trip terrified me at first, but it made me completely independent." },
    { category: "travel", title: "Alpine Lake Expeditions", ambienceId: "calm_lake", description: "Mountain lakes, pine scents, and camping under untamed skies.", confession: "Waking up in a tent next to a crystal clear alpine lake was pure magic." },
    { category: "travel", title: "Nordic Lights Journeys", ambienceId: "northern_sky", description: "Chasing aurora borealis, remote cabins, and winter wanderlust.", confession: "Standing under the green dancing aurora in Iceland was a spiritual experience." },

    // 15. Books & Literature (3 rooms)
    { category: "books", title: "Rainy Reading Nook", ambienceId: "rainy_window", description: "Curling up with novels, hot chocolate, and endless book recommendations.", confession: "Nothing compares to the smell of old paperbacks on a rainy Sunday afternoon." },
    { category: "books", title: "Midnight Poetry Corner", ambienceId: "moonlit_window", description: "Writing stanzas, verse interpretation, and poetic reflections.", confession: "Writing poetry is the only way I can translate emotions that words can't usually hold." },
    { category: "books", title: "Autumn Pages Sanctuary", ambienceId: "falling_leaves", description: "Classic literature, philosophical treatises, and character studies.", confession: "Re-reading 'The Little Prince' as an adult hit me way harder than when I was a child." },

    // 16. Advice & Life Lessons (4 rooms)
    { category: "advice", title: "Still Waters Guidance", ambienceId: "calm_lake", description: "Wise, non-judgmental guidance for difficult life crossroads.", confession: "If you're hesitating between two choices, choose the one that expands your world." },
    { category: "advice", title: "Dawn of New Beginnings", ambienceId: "mountain_dawn", description: "Starting over at any age with hope, dignity, and resilience.", confession: "It is never too late to reinvent yourself. Started university again at age 34." },
    { category: "advice", title: "Breathe Easy Perspective", ambienceId: "floating_clouds", description: "Putting problems into perspective and embracing daily gratitude.", confession: "Most things we panic about today won't even matter five months from now." },
    { category: "advice", title: "Quiet Pier Wisdom", ambienceId: "lonely_pier", description: "Lessons learned through mistakes, patience, and time.", confession: "Be gentle with your past self; you were doing the best you could with the tools you had." }
];

async function seed() {
    console.log('🚀 Starting 50 Diverse Themed Rooms Seeding Script...');
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
    let createdCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < ROOM_DATA.length; i++) {
        const item = ROOM_DATA[i];
        const shouldKeepJoined = i < 15; // First 15 joined by user, remaining 35 unjoined (discoverable)
        const categoryKey = item.category.toLowerCase().replace(/\s+/g, '_');
        const titleSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const roomFamilyKey = `public:${categoryKey}:${titleSlug}`;
        const shardKey = `${categoryKey}:20260828:0`;

        try {
            let room = await ConfessionRoom.findOne({ roomFamilyKey, roomInstance: 1 });

            if (!room) {
                const roomId = await getNextSequence('confession_room');
                room = await ConfessionRoom.create({
                    id: roomId,
                    shardKey,
                    title: item.title,
                    description: item.description,
                    category: categoryKey,
                    ambienceId: item.ambienceId,
                    roomFamilyKey,
                    roomInstance: 1,
                    maxCapacity: 100,
                    currentUserCount: shouldKeepJoined ? 1 : 0,
                    roomType: 'public',
                    createdByUserId: userId,
                    isActive: true
                });
                createdCount++;
            } else {
                await ConfessionRoom.updateOne(
                    { id: room.id },
                    {
                        $set: {
                            title: item.title,
                            description: item.description,
                            category: categoryKey,
                            ambienceId: item.ambienceId,
                            currentUserCount: shouldKeepJoined ? 1 : 0,
                            isActive: true
                        }
                    }
                );
                updatedCount++;
            }

            const roomId = room.id;

            // Handle Membership
            const existingMember = await ConfessionRoomMember.findOne({ roomId, userId });
            if (shouldKeepJoined) {
                if (!existingMember) {
                    await ConfessionRoomMember.create({
                        roomId,
                        userId,
                        alias: (user.username || 'Member') + '_' + Math.floor(100 + Math.random() * 900),
                        isActive: true,
                        joinedAt: new Date(),
                        lastActiveAt: new Date()
                    });
                } else if (!existingMember.isActive) {
                    await ConfessionRoomMember.updateOne({ roomId, userId }, { $set: { isActive: true } });
                }
            } else {
                if (existingMember) {
                    await ConfessionRoomMember.deleteOne({ roomId, userId });
                }
            }

            // Create or update Confession Post
            const existingPost = await ConfessionPost.findOne({ roomId });
            if (!existingPost) {
                const postId = await getNextSequence('confession_post');
                const contentHash = crypto.createHash('sha256').update(item.confession.trim()).digest('hex');
                await ConfessionPost.create({
                    id: postId,
                    shardKey,
                    roomId,
                    alias: 'Wanderer_' + Math.floor(100 + Math.random() * 900),
                    content: item.confession,
                    contentHash,
                    author: userId,
                    moderationStatus: 'approved',
                    isPublished: true,
                    createdAt: new Date()
                });
            }

            console.log(`[${i + 1}/50] [${item.category}] "${item.title}" | Ambience: ${item.ambienceId}`);
        } catch (err) {
            console.error(`❌ Failed room [${i + 1}]: "${item.title}":`, err.message);
        }
    }

    console.log('\n========================================');
    console.log(`✅ 50 Diverse Rooms Seed Complete!`);
    console.log(`- Total Configured: ${ROOM_DATA.length}`);
    console.log(`- Newly Created: ${createdCount}`);
    console.log(`- Updated with Images/Categories: ${updatedCount}`);
    console.log('========================================\n');

    process.exit(0);
}

seed().catch((err) => {
    console.error('Fatal Seed Error:', err);
    process.exit(1);
});
