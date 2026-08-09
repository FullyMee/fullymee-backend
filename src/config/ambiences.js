/**
 * Central Ambience Library Configuration
 * Defines all ambiences grouped by category.
 */

const AMBIENCE_LIBRARY = [
    // ==================================================
    // 1. LATE NIGHT
    // ==================================================
    {
        id: "neon_skyline",
        category: "late_night",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["urban", "modern", "ambitious", "business", "startup", "energy", "social", "night", "city", "skyline"],
        mood: ["energetic", "modern", "ambitious"]
    },
    {
        id: "moonlit_window",
        category: "late_night",
        image: "/ambience/late_night/moonlit_window.png",
        tags: ["quiet", "thoughtful", "reflection", "sleep", "peaceful", "night", "cozy", "bedroom", "window"],
        mood: ["peaceful", "reflective", "quiet"]
    },
    {
        id: "rainy_midnight",
        category: "late_night",
        image: "/ambience/late_night/rainy_midnight.png",
        tags: ["rain", "quiet", "reflective", "late", "night", "emotional", "lonely", "dark", "melancholy"],
        mood: ["reflective", "melancholy", "quiet"]
    },
    {
        id: "aurora_night",
        category: "late_night",
        image: "/ambience/late_night/aurora_night.png",
        tags: ["sky", "aurora", "stars", "peaceful", "quiet", "night", "deep", "wondrous"],
        mood: ["peaceful", "wondrous", "calm"]
    },
    {
        id: "quiet_cafe",
        category: "late_night",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["conversation", "social", "casual", "relaxed", "coffee", "friendly", "night", "talk"],
        mood: ["casual", "warm", "social"]
    },
    {
        id: "starry_balcony",
        category: "late_night",
        image: "/ambience/late_night/aurora_night.png",
        tags: ["stars", "balcony", "night", "fresh", "breeze", "quiet", "thoughtful", "sky"],
        mood: ["breezy", "thoughtful", "peaceful"]
    },

    // ==================================================
    // 2. ANXIETY & CALM
    // ==================================================
    {
        id: "calm_lake",
        category: "anxiety",
        image: "/ambience/anxiety/calm_lake.png",
        tags: ["lake", "water", "peaceful", "calm", "serene", "nature", "breath", "soothing"],
        mood: ["calm", "serene", "soothing"]
    },
    {
        id: "floating_clouds",
        category: "anxiety",
        image: "/ambience/anxiety/floating_clouds.png",
        tags: ["clouds", "sky", "light", "airy", "peaceful", "gentle", "calm", "mindfulness"],
        mood: ["light", "gentle", "peaceful"]
    },
    {
        id: "misty_forest",
        category: "anxiety",
        image: "/ambience/anxiety/misty_forest.png",
        tags: ["forest", "mist", "trees", "quiet", "grounding", "nature", "solitude", "calm"],
        mood: ["grounding", "quiet", "solitary"]
    },
    {
        id: "mountain_dawn",
        category: "anxiety",
        image: "/ambience/anxiety/mountain_dawn.png",
        tags: ["mountain", "dawn", "sunrise", "hope", "fresh", "perspective", "clarity", "breath"],
        mood: ["hopeful", "clear", "inspiring"]
    },
    {
        id: "northern_sky",
        category: "anxiety",
        image: "/ambience/anxiety/northern_sky.png",
        tags: ["sky", "northern", "stars", "spacious", "wonder", "deep", "calm", "silent"],
        mood: ["spacious", "calm", "silent"]
    },

    // ==================================================
    // 3. HEARTBREAK
    // ==================================================
    {
        id: "broken_letter",
        category: "heartbreak",
        image: "/ambience/heartbreak/broken_letter.png",
        tags: ["letter", "memories", "past", "sad", "goodbye", "heartbreak", "emotional", "pain"],
        mood: ["sad", "nostalgic", "poignant"]
    },
    {
        id: "empty_park_bench",
        category: "heartbreak",
        image: "/ambience/heartbreak/empty_park_bench.png",
        tags: ["bench", "park", "empty", "lonely", "solitude", "waiting", "heartbreak", "quiet"],
        mood: ["lonely", "solitary", "quiet"]
    },
    {
        id: "falling_leaves",
        category: "heartbreak",
        image: "/ambience/heartbreak/falling_leaves.png",
        tags: ["autumn", "leaves", "change", "letting_go", "melancholy", "reflection", "sad"],
        mood: ["melancholy", "reflective", "gentle"]
    },
    {
        id: "lonely_pier",
        category: "heartbreak",
        image: "/ambience/heartbreak/lonely_pier.png",
        tags: ["pier", "ocean", "water", "lonely", "distance", "heartbreak", "solitude", "reflection"],
        mood: ["lonely", "deep", "reflective"]
    },
    {
        id: "quiet_beach",
        category: "heartbreak",
        image: "/ambience/heartbreak/quiet_beach.png",
        tags: ["beach", "waves", "quiet", "healing", "solitude", "ocean", "peaceful", "reflection"],
        mood: ["healing", "peaceful", "reflective"]
    },
    {
        id: "rainy_window",
        category: "heartbreak",
        image: "/ambience/heartbreak/rainy_window.png",
        tags: ["rain", "window", "sadness", "tears", "inside", "cozy", "heartbreak", "emotional"],
        mood: ["emotional", "cozy", "sad"]
    },
    {
        id: "sunset_memories",
        category: "heartbreak",
        image: "/ambience/heartbreak/sunset_memories.png",
        tags: ["sunset", "memories", "nostalgia", "bittersweet", "healing", "evening", "heartbreak"],
        mood: ["bittersweet", "nostalgic", "warm"]
    },
    {
        id: "wilted_roses",
        category: "heartbreak",
        image: "/ambience/heartbreak/wilted_roses.png",
        tags: ["roses", "wilted", "love", "ended", "grief", "poignant", "heartbreak"],
        mood: ["poignant", "grieving", "quiet"]
    },

    // ==================================================
    // 4. RELATIONSHIPS
    // ==================================================
    {
        id: "cherry_blossoms",
        category: "relationships",
        image: "/ambience/relationships/cherry_blossoms.png",
        tags: ["blossoms", "romance", "soft", "sweet", "love", "spring", "gentle", "beauty"],
        mood: ["romantic", "soft", "sweet"]
    },
    {
        id: "couples_cafe",
        category: "relationships",
        image: "/ambience/relationships/couples_cafe.png",
        tags: ["cafe", "date", "coffee", "conversation", "couples", "love", "warm", "cozy"],
        mood: ["warm", "romantic", "social"]
    },
    {
        id: "garden_path",
        category: "relationships",
        image: "/ambience/relationships/garden_path.png",
        tags: ["garden", "walk", "together", "path", "nature", "peaceful", "bonding", "relationship"],
        mood: ["peaceful", "harmonious", "warm"]
    },
    {
        id: "golden_bridge",
        category: "relationships",
        image: "/ambience/relationships/golden_bridge.png",
        tags: ["bridge", "connection", "golden", "sunset", "trust", "bond", "relationship", "future"],
        mood: ["hopeful", "connected", "warm"]
    },
    {
        id: "heart_lanterns",
        category: "relationships",
        image: "/ambience/relationships/heart_lanterns.png",
        tags: ["lanterns", "heart", "lights", "magical", "romance", "celebration", "love"],
        mood: ["magical", "romantic", "joyful"]
    },
    {
        id: "love_letters",
        category: "relationships",
        image: "/ambience/relationships/love_letters.png",
        tags: ["letters", "love", "affection", "feelings", "intimate", "deep", "written"],
        mood: ["intimate", "tender", "deep"]
    },
    {
        id: "sunset_beach",
        category: "relationships",
        image: "/ambience/relationships/sunset_beach.png",
        tags: ["beach", "sunset", "romance", "walk", "ocean", "together", "warmth"],
        mood: ["romantic", "relaxing", "warm"]
    },

    // ==================================================
    // 5. CAREER
    // ==================================================
    {
        id: "meeting_room",
        category: "career",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["interview", "career", "professional", "job", "office", "meeting", "placement", "business"],
        mood: ["focused", "professional", "ambitious"]
    },
    {
        id: "work_desk",
        category: "career",
        image: "/ambience/anxiety/mountain_dawn.png",
        tags: ["desk", "work", "focus", "laptop", "career", "productivity", "goals", "resume"],
        mood: ["productive", "focused", "determined"]
    },
    {
        id: "sunrise_workspace",
        category: "career",
        image: "/ambience/anxiety/mountain_dawn.png",
        tags: ["sunrise", "workspace", "future", "ambition", "career", "fresh", "morning", "motivation"],
        mood: ["inspiring", "motivated", "optimistic"]
    },

    // ==================================================
    // 6. COLLEGE
    // ==================================================
    {
        id: "campus_library",
        category: "college",
        image: "/ambience/anxiety/misty_forest.png",
        tags: ["exam", "study", "college", "books", "library", "campus", "quiet", "student", "placement"],
        mood: ["scholarly", "studious", "quiet"]
    },
    {
        id: "dorm_desk",
        category: "college",
        image: "/ambience/late_night/moonlit_window.png",
        tags: ["dorm", "college", "assignment", "late_night", "student", "friends", "roommate", "exam"],
        mood: ["relatable", "cozy", "studious"]
    },

    // ==================================================
    // 7. TECH & CODING
    // ==================================================
    {
        id: "rgb_setup",
        category: "tech_coding",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["coding", "developer", "programming", "technology", "setup", "software", "hacker", "modern"],
        mood: ["energetic", "focused", "techy"]
    },
    {
        id: "code_editor_glow",
        category: "tech_coding",
        image: "/ambience/late_night/rainy_midnight.png",
        tags: ["code", "developer", "tech", "algorithm", "late_night", "bugs", "screen", "terminal"],
        mood: ["focused", "deep", "solitary"]
    },

    // ==================================================
    // 8. CASUAL CHATS
    // ==================================================
    {
        id: "chill_sofa",
        category: "casual_chat",
        image: "/ambience/relationships/couples_cafe.png",
        tags: ["conversation", "social", "casual", "relaxed", "sofa", "friendly", "lounge", "talk", "chat"],
        mood: ["relaxed", "friendly", "cozy"]
    },
    {
        id: "campfire_talks",
        category: "casual_chat",
        image: "/ambience/relationships/sunset_beach.png",
        tags: ["campfire", "friends", "talk", "social", "night", "warm", "cozy", "gathering"],
        mood: ["warm", "social", "relaxed"]
    },

    // ==================================================
    // 9. STARTUPS
    // ==================================================
    {
        id: "founders_lounge",
        category: "startups",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["startup", "founder", "business", "funding", "investor", "building", "pitch", "ambition"],
        mood: ["ambitious", "driven", "innovative"]
    },

    // ==================================================
    // 10. CONFESSIONS & ADVICE & FAMILY & OTHER CATEGORIES
    // ==================================================
    {
        id: "whisper_booth",
        category: "confessions",
        image: "/ambience/heartbreak/rainy_window.png",
        tags: ["confession", "secret", "truth", "private", "honest", "deep", "whisper"],
        mood: ["intimate", "honest", "mysterious"]
    },
    {
        id: "family_dining",
        category: "family",
        image: "/ambience/relationships/garden_path.png",
        tags: ["family", "home", "parents", "dinner", "support", "relatives", "house"],
        mood: ["warm", "familiar", "grounded"]
    },
    {
        id: "cozy_nook",
        category: "books",
        image: "/ambience/late_night/moonlit_window.png",
        tags: ["books", "reading", "author", "literature", "story", "quiet", "coffee"],
        mood: ["cozy", "imaginative", "quiet"]
    },
    {
        id: "arcade_neon",
        category: "gaming",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["gaming", "gamer", "play", "arcade", "esports", "streamer", "match"],
        mood: ["energetic", "fun", "competitive"]
    },
    {
        id: "fitness_studio",
        category: "fitness",
        image: "/ambience/anxiety/mountain_dawn.png",
        tags: ["gym", "workout", "health", "fitness", "training", "energy", "motivation"],
        mood: ["active", "energetic", "motivated"]
    },
    {
        id: "finance_hub",
        category: "finance",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["finance", "money", "stocks", "investment", "crypto", "business", "market"],
        mood: ["analytical", "ambitious", "sharp"]
    },
    {
        id: "parliament_hall",
        category: "politics",
        image: "/ambience/anxiety/misty_forest.png",
        tags: ["politics", "debate", "government", "policy", "news", "discussion", "society"],
        mood: ["serious", "analytical", "engaging"]
    },
    {
        id: "scenic_overlook",
        category: "travel",
        image: "/ambience/anxiety/calm_lake.png",
        tags: ["travel", "journey", "scenic", "vacation", "explore", "nature", "adventure"],
        mood: ["adventurous", "free", "inspiring"]
    },
    {
        id: "cinema_hall",
        category: "entertainment",
        image: "/ambience/late_night/neon_skyline.png",
        tags: ["movies", "entertainment", "music", "shows", "cinema", "popcorn", "fun"],
        mood: ["fun", "engaging", "entertaining"]
    },
    {
        id: "guiding_light",
        category: "advice",
        image: "/ambience/anxiety/mountain_dawn.png",
        tags: ["advice", "guidance", "help", "mentor", "perspective", "support", "life"],
        mood: ["supportive", "wise", "reassuring"]
    }
];

module.exports = {
    AMBIENCE_LIBRARY
};
