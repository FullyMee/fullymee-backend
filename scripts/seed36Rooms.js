require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const crypto = require('crypto');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const ConfessionRoom = require('../src/models/confessionRoom.model');
const ConfessionRoomMember = require('../src/models/confessionRoomMember.model');
const ConfessionPost = require('../src/models/confessionPost.model');
const { getNextSequence, setSequenceAtLeast } = require('../src/utils/sequence');

// ═══════════════════════════════════════════════════════════════════════════════
// 36 Unique Rooms — Every category AND every ambience covered at least once
// ═══════════════════════════════════════════════════════════════════════════════
//
// 19 Categories:  late_night, heartbreak, anxiety, relationships, family,
//                 college, career, tech_coding, casual_chat, confessions,
//                 gaming, entertainment, fitness, finance, politics,
//                 startups, travel, books, advice
//
// 24 Ambiences:   moonlit_window, neon_skyline, rainy_midnight, aurora_night,
//                 calm_lake, floating_clouds, misty_forest, mountain_dawn,
//                 northern_sky, broken_letter, empty_park_bench, falling_leaves,
//                 lonely_pier, quiet_beach, rainy_window, sunset_memories,
//                 wilted_roses, cherry_blossoms, couples_cafe, garden_path,
//                 golden_bridge, heart_lanterns, love_letters, sunset_beach
// ═══════════════════════════════════════════════════════════════════════════════

const ROOM_DATA = [
    // ── 1. Late Night ─────────────────────────────────────────────────
    {
        category: "late_night",
        title: "Insomniac's Sanctuary",
        ambienceId: "moonlit_window",
        description: "A safe space for those awake when the world sleeps. Share your late-night thoughts freely.",
        confession: "I find clarity at 2 AM that daylight never seems to bring."
    },
    {
        category: "late_night",
        title: "Neon Pulse After Dark",
        ambienceId: "neon_skyline",
        description: "City lights and sleepless streets. For those who feel alive after midnight.",
        confession: "The city hums a different tune past midnight — quieter, more honest."
    },

    // ── 2. Heartbreak ─────────────────────────────────────────────────
    {
        category: "heartbreak",
        title: "Undelivered Goodbye",
        ambienceId: "broken_letter",
        description: "Words we crumpled and threw away. Goodbyes we never got to say.",
        confession: "I kept drafting a farewell message for months. Today I finally deleted the entire thread."
    },
    {
        category: "heartbreak",
        title: "Wilted Roses & Healing",
        ambienceId: "wilted_roses",
        description: "Beauty fades, but the thorns teach us. Conversations about moving forward.",
        confession: "I stopped watering a love that was already gone. The garden looks emptier, but I feel lighter."
    },

    // ── 3. Anxiety ────────────────────────────────────────────────────
    {
        category: "anxiety",
        title: "Mountain Dawn Breathwork",
        ambienceId: "mountain_dawn",
        description: "Grounding exercises and calming conversations at the break of dawn.",
        confession: "Counting backwards from ten while watching the sunrise actually stopped a panic attack today."
    },
    {
        category: "anxiety",
        title: "Northern Lights Meditation",
        ambienceId: "northern_sky",
        description: "Let the aurora calm your racing mind. Slow conversations, no rush.",
        confession: "I told my manager I needed a mental health day. The world didn't end."
    },

    // ── 4. Relationships ──────────────────────────────────────────────
    {
        category: "relationships",
        title: "Love Letters Aloud",
        ambienceId: "love_letters",
        description: "Reading love notes you never sent, or celebrating the ones you did.",
        confession: "My partner left a sticky note on my coffee mug saying 'proud of you.' Simplest thing, biggest impact."
    },
    {
        category: "relationships",
        title: "Garden Path Together",
        ambienceId: "garden_path",
        description: "Walking through the seasons of a relationship — spring through winter.",
        confession: "We scheduled a weekly date night. It sounds forced, but it saved everything."
    },

    // ── 5. Family ─────────────────────────────────────────────────────
    {
        category: "family",
        title: "Quiet Shore Conversations",
        ambienceId: "quiet_beach",
        description: "Healing family wounds one gentle wave at a time.",
        confession: "Called my father after two years of silence. Neither of us spoke for the first thirty seconds, but it was enough."
    },
    {
        category: "family",
        title: "Sunset Memories with Kin",
        ambienceId: "sunset_memories",
        description: "Nostalgia for simpler family times and lessons passed down through generations.",
        confession: "My grandmother's recipe book fell open today. Her handwriting hit harder than any photograph."
    },

    // ── 6. College ────────────────────────────────────────────────────
    {
        category: "college",
        title: "Aurora Exam Night",
        ambienceId: "aurora_night",
        description: "Pulling all-nighters under celestial lights. Study stress meets starry wonder.",
        confession: "Failed my first exam ever this semester. Turns out it taught me more than the A's did."
    },
    {
        category: "college",
        title: "Rainy Campus Reflections",
        ambienceId: "rainy_midnight",
        description: "Walking rain-soaked campus paths and figuring out who you really are.",
        confession: "Changed my major three times and I'm not ashamed. Each detour revealed something new about myself."
    },

    // ── 7. Career ─────────────────────────────────────────────────────
    {
        category: "career",
        title: "Golden Hour Networking",
        ambienceId: "golden_bridge",
        description: "Building bridges in your career. Mentorship, pivots, and honest work talk.",
        confession: "My best career move was reaching out to a stranger on LinkedIn. They became my mentor."
    },
    {
        category: "career",
        title: "Misty Monday Mornings",
        ambienceId: "misty_forest",
        description: "Navigating the fog of corporate life and finding meaning in daily work.",
        confession: "Took a 30% pay cut to join a company whose mission I believe in. Never been happier."
    },

    // ── 8. Tech & Coding ──────────────────────────────────────────────
    {
        category: "tech_coding",
        title: "Floating Cloud Deployments",
        ambienceId: "floating_clouds",
        description: "Cloud architecture, DevOps tales, and deploying with confidence at 3 AM.",
        confession: "Pushed to production on a Friday. Everything worked. I still can't believe it."
    },
    {
        category: "tech_coding",
        title: "Calm Lake Debugging",
        ambienceId: "calm_lake",
        description: "Zen-like patience for the hardest bugs. Rubber duck debugging, reimagined.",
        confession: "The bug that took me 8 hours was a missing semicolon. I laughed so hard I cried."
    },

    // ── 9. Casual Chat ────────────────────────────────────────────────
    {
        category: "casual_chat",
        title: "Heart Lantern Hangout",
        ambienceId: "heart_lanterns",
        description: "Warm, glowing conversations about absolutely nothing and everything.",
        confession: "Made a friend on the internet today who lives 6,000 miles away. Distance means nothing when vibes align."
    },
    {
        category: "casual_chat",
        title: "Couples Café Banter",
        ambienceId: "couples_cafe",
        description: "Cozy corner conversations — weekend plans, guilty pleasures, random hot takes.",
        confession: "I eat cereal for dinner at least three times a week and I refuse to feel guilty about it."
    },

    // ── 10. Confessions ───────────────────────────────────────────────
    {
        category: "confessions",
        title: "Empty Bench Truths",
        ambienceId: "empty_park_bench",
        description: "Sit down, breathe, and let the weight of unspoken truths finally leave your chest.",
        confession: "I smile all day at work, but the commute home is when the mask comes off."
    },
    {
        category: "confessions",
        title: "Falling Leaves of Honesty",
        ambienceId: "falling_leaves",
        description: "As the leaves fall, so do pretenses. A room for radical honesty.",
        confession: "I told my best friend the truth I'd been hiding for five years. They hugged me instead of leaving."
    },

    // ── 11. Gaming ────────────────────────────────────────────────────
    {
        category: "gaming",
        title: "Moonlit RPG Tavern",
        ambienceId: "moonlit_window",
        description: "Late-night RPG stories, character builds, and legendary loot confessions.",
        confession: "Spent 200 hours on a single save file. No regrets — that world felt more real than reality sometimes."
    },
    {
        category: "gaming",
        title: "Rainy Day Retro Gaming",
        ambienceId: "rainy_window",
        description: "Nostalgic pixel art, classic soundtracks, and the games that shaped us.",
        confession: "Hearing the Zelda title screen music still gives me the same butterflies it did when I was eight."
    },

    // ── 12. Entertainment ─────────────────────────────────────────────
    {
        category: "entertainment",
        title: "Cherry Blossom Anime Club",
        ambienceId: "cherry_blossoms",
        description: "Anime watchlists, manga recommendations, and emotional scene breakdowns.",
        confession: "Cried watching a 12-episode anime more than I cried in all of last year. Fiction heals differently."
    },
    {
        category: "entertainment",
        title: "Sunset Beach Film Festival",
        ambienceId: "sunset_beach",
        description: "Indie films, cinematography love, and directors who changed how you see the world.",
        confession: "A single camera shot in 'Lost in Translation' made me rethink my entire perspective on loneliness."
    },

    // ── 13. Fitness ───────────────────────────────────────────────────
    {
        category: "fitness",
        title: "Lonely Pier Runners Club",
        ambienceId: "lonely_pier",
        description: "Solo runners, ocean-side jogs, and the therapy of rhythmic footsteps.",
        confession: "Started running to lose weight. Kept running because it silences my overthinking like nothing else."
    },
    {
        category: "fitness",
        title: "Garden Path Morning Walks",
        ambienceId: "garden_path",
        description: "Gentle morning walks, stretching routines, and celebrating small physical wins.",
        confession: "Walking 10,000 steps a day for 90 days changed my sleep, mood, and posture completely."
    },

    // ── 14. Finance ───────────────────────────────────────────────────
    {
        category: "finance",
        title: "Aurora Investment Circle",
        ambienceId: "aurora_night",
        description: "Late-night market analysis, portfolio strategy, and wealth-building philosophy.",
        confession: "Started investing ₹500 a month two years ago. My portfolio just crossed ₹50,000. Compound interest is magic."
    },
    {
        category: "finance",
        title: "Quiet Beach Budgeting",
        ambienceId: "quiet_beach",
        description: "Peaceful money conversations — saving, spending wisely, and financial peace.",
        confession: "Deleted three shopping apps from my phone. My savings account thanked me within a month."
    },

    // ── 15. Politics ──────────────────────────────────────────────────
    {
        category: "politics",
        title: "Mountain Dawn Debates",
        ambienceId: "mountain_dawn",
        description: "Respectful discourse on governance, policy, and civic responsibility.",
        confession: "I disagreed with my closest friend on politics today. We debated for an hour and left still respecting each other."
    },
    {
        category: "politics",
        title: "Pier-side Policy Talks",
        ambienceId: "lonely_pier",
        description: "Looking out at the horizon while discussing what kind of world we want to build.",
        confession: "Volunteered at a local council meeting for the first time. Felt powerless going in, empowered coming out."
    },

    // ── 16. Startups ──────────────────────────────────────────────────
    {
        category: "startups",
        title: "Neon Pitch Night",
        ambienceId: "neon_skyline",
        description: "Startup pitches, pivot stories, and founder confessions under city lights.",
        confession: "My first startup failed spectacularly. My second one just got its first paying customer."
    },
    {
        category: "startups",
        title: "Dawn Founders' Circle",
        ambienceId: "mountain_dawn",
        description: "Early risers building the future — product ideas, MVPs, and honest founder struggles.",
        confession: "Being a solo founder is the loneliest job on Earth, but every small win feels like conquering Everest."
    },

    // ── 17. Travel ────────────────────────────────────────────────────
    {
        category: "travel",
        title: "Northern Lights Expedition",
        ambienceId: "northern_sky",
        description: "Chasing lights across continents. Solo travel courage and wanderlust stories.",
        confession: "Booked a one-way ticket to a country where I knew nobody. Best decision I ever made."
    },
    {
        category: "travel",
        title: "Sunset Memories Abroad",
        ambienceId: "sunset_memories",
        description: "Golden hour photographs from places that changed who you are.",
        confession: "A stranger in a tiny Italian village invited me for dinner. That meal taught me more about kindness than any book."
    },

    // ── 18. Books ─────────────────────────────────────────────────────
    {
        category: "books",
        title: "Wilted Roses Poetry Salon",
        ambienceId: "wilted_roses",
        description: "Bittersweet verses, melancholic prose, and the beauty found in literary heartbreak.",
        confession: "A single Rumi poem pulled me out of the darkest month of my life."
    },
    {
        category: "books",
        title: "Love Letters Book Club",
        ambienceId: "love_letters",
        description: "Romance novels, epistolary fiction, and the timeless power of written affection.",
        confession: "Re-reading old love letters from classic literature reminds me that deep feeling is not weakness."
    },

    // ── 19. Advice ────────────────────────────────────────────────────
    {
        category: "advice",
        title: "Calm Lake Life Guidance",
        ambienceId: "calm_lake",
        description: "Patient, thoughtful advice for life's biggest crossroads.",
        confession: "The best advice I ever received was: 'You don't have to set yourself on fire to keep others warm.'"
    },
    {
        category: "advice",
        title: "Floating Clouds Perspective",
        ambienceId: "floating_clouds",
        description: "Stepping back, seeing the bigger picture, and finding gratitude in chaos.",
        confession: "Wrote down three things I'm grateful for every night for a year. It genuinely rewired how I see my life."
    },
];

async function seed36Rooms() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('   🌟 SEEDING 36 UNIQUE ROOMS (ALL CATEGORIES &      ');
    console.log('      AMBIENCES COVERED) FOR FULLYMEE PRODUCTION      ');
    console.log('═══════════════════════════════════════════════════════\n');

    await connectDB();

    // Sync sequence counters
    const maxRoom = await ConfessionRoom.findOne().sort({ id: -1 }).select({ id: 1 }).lean();
    if (maxRoom && maxRoom.id) await setSequenceAtLeast('confession_room', maxRoom.id);
    const maxPost = await ConfessionPost.findOne().sort({ id: -1 }).select({ id: 1 }).lean();
    if (maxPost && maxPost.id) await setSequenceAtLeast('confession_post', maxPost.id);

    let user = await User.findOne().sort({ id: 1 }).lean();
    if (!user) {
        user = await User.create({ id: 1, username: 'fullymee_official' });
        console.log('Created official user with ID:', user.id);
    } else {
        console.log(`Using existing user: ID ${user.id} (${user.username || 'anonymous'})`);
    }

    const userId = user.id;
    let created = 0, skipped = 0;

    // Track coverage
    const categoriesSeen = new Set();
    const ambiencesSeen = new Set();

    for (let i = 0; i < ROOM_DATA.length; i++) {
        const item = ROOM_DATA[i];
        const categoryKey = item.category.toLowerCase().replace(/\s+/g, '_');
        const titleSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const roomFamilyKey = `public:${categoryKey}:${titleSlug}`;
        const shardKey = `${categoryKey}:20260831:0`;

        categoriesSeen.add(categoryKey);
        ambiencesSeen.add(item.ambienceId);

        try {
            const existing = await ConfessionRoom.findOne({ roomFamilyKey, roomInstance: 1 });
            if (existing) {
                console.log(`  ⏭  [${i + 1}/36] SKIP (exists): "${item.title}"`);
                skipped++;
                continue;
            }

            const roomId = await getNextSequence('confession_room');
            await ConfessionRoom.create({
                id: roomId,
                shardKey,
                title: item.title,
                description: item.description,
                category: categoryKey,
                ambienceId: item.ambienceId,
                roomFamilyKey,
                roomInstance: 1,
                maxCapacity: 100,
                currentUserCount: 0,
                roomType: 'public',
                createdByUserId: userId,
                isActive: true
            });

            // Create seed confession post
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

            console.log(`  ✅ [${i + 1}/36] [${categoryKey}] "${item.title}" | Ambience: ${item.ambienceId}`);
            created++;
        } catch (err) {
            console.error(`  ❌ [${i + 1}/36] FAILED "${item.title}":`, err.message);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`  ✅ SEED COMPLETE!`);
    console.log(`  • Rooms Created: ${created}`);
    console.log(`  • Rooms Skipped: ${skipped}`);
    console.log(`  • Categories Covered: ${categoriesSeen.size}/19`);
    console.log(`  • Ambiences Covered: ${ambiencesSeen.size}/24`);
    console.log('═══════════════════════════════════════════════════════');

    if (categoriesSeen.size < 19) {
        const allCats = ['late_night','heartbreak','anxiety','relationships','family','college','career','tech_coding','casual_chat','confessions','gaming','entertainment','fitness','finance','politics','startups','travel','books','advice'];
        const missing = allCats.filter(c => !categoriesSeen.has(c));
        console.log(`  ⚠ Missing categories: ${missing.join(', ')}`);
    }
    if (ambiencesSeen.size < 24) {
        const allAmb = ['moonlit_window','neon_skyline','rainy_midnight','aurora_night','calm_lake','floating_clouds','misty_forest','mountain_dawn','northern_sky','broken_letter','empty_park_bench','falling_leaves','lonely_pier','quiet_beach','rainy_window','sunset_memories','wilted_roses','cherry_blossoms','couples_cafe','garden_path','golden_bridge','heart_lanterns','love_letters','sunset_beach'];
        const missing = allAmb.filter(a => !ambiencesSeen.has(a));
        console.log(`  ⚠ Missing ambiences: ${missing.join(', ')}`);
    }

    process.exit(0);
}

seed36Rooms().catch((err) => {
    console.error('Fatal Seed Error:', err);
    process.exit(1);
});
