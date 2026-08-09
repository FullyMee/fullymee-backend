/**
 * Keyword-to-Tag Dictionary & Word Normalization Map
 * Maps input words/terms to semantic ambience tags.
 */

const KEYWORD_DICTIONARY = {
    // Startup & Business
    "startup": ["startup", "business", "ambitious", "modern", "building"],
    "startups": ["startup", "business", "ambitious", "modern", "building"],
    "founder": ["startup", "business", "ambitious", "founder"],
    "founders": ["startup", "business", "ambitious", "founder"],
    "funding": ["business", "startup", "investor"],
    "investor": ["business", "finance", "startup"],
    "investment": ["finance", "business"],
    "pitch": ["startup", "business", "ambitious"],
    "company": ["business", "office", "work"],

    // Tech & Coding
    "coding": ["coding", "technology", "modern", "software", "developer"],
    "code": ["coding", "technology", "software"],
    "developer": ["technology", "coding", "software", "developer"],
    "developers": ["technology", "coding", "software", "developer"],
    "programming": ["technology", "coding", "software"],
    "software": ["technology", "coding"],
    "algorithm": ["technology", "coding"],
    "hacker": ["coding", "technology"],

    // Career & Study
    "interview": ["interview", "career", "professional"],
    "job": ["career", "professional", "work"],
    "placement": ["career", "college", "interview", "exam"],
    "placements": ["career", "college", "interview"],
    "exam": ["college", "study", "exam", "assignment"],
    "exams": ["college", "study", "exam"],
    "study": ["college", "study", "books", "library"],
    "assignment": ["college", "study", "assignment"],

    // Sleep & Night & Atmosphere
    "sleep": ["sleep", "quiet", "peaceful", "bedroom"],
    "sleepless": ["sleep", "night", "lonely", "quiet"],
    "awake": ["night", "late", "quiet"],
    "2am": ["night", "late", "quiet", "reflection"],
    "midnight": ["night", "late", "rain"],
    "rain": ["rain", "reflective", "melancholy", "quiet"],
    "rainy": ["rain", "reflective", "melancholy"],
    "lonely": ["lonely", "quiet", "reflective", "solitude"],
    "loneliness": ["lonely", "quiet", "reflective"],
    "burnout": ["lonely", "reflection", "quiet", "anxiety"],
    "healing": ["healing", "peaceful", "reflection"],
    "moving": ["healing", "reflection", "change"],
    "memories": ["memories", "nostalgic", "reflection", "bittersweet"],
    "nostalgia": ["memories", "nostalgic", "reflection"],

    // Social & Casual
    "friends": ["social", "friendly", "conversation"],
    "friendship": ["social", "friendly", "bonding"],
    "talk": ["conversation", "social", "talk"],
    "talks": ["conversation", "social", "talk"],
    "chat": ["conversation", "social", "casual"],
    "chats": ["conversation", "social", "casual"],
    "party": ["social", "energetic"],
    "chill": ["casual", "relaxed", "sofa"],
    "casual": ["casual", "relaxed", "social"],

    // Emotion & Heartbreak
    "heartbreak": ["heartbreak", "sad", "emotional", "pain"],
    "ex": ["heartbreak", "past", "memories"],
    "breakup": ["heartbreak", "sad", "goodbye"],
    "crying": ["sad", "heartbreak", "rain"],
    "love": ["love", "romance", "relationship"],
    "dating": ["romance", "date", "couples", "relationship"],
    "couple": ["couples", "love", "romance"],

    // Anxiety & Calming
    "anxiety": ["anxiety", "calm", "breath", "peaceful"],
    "panic": ["anxiety", "calm", "soothing", "breath"],
    "stress": ["anxiety", "calm", "peaceful"],
    "worry": ["anxiety", "calm", "gentle"],
    "overthinking": ["anxiety", "reflection", "quiet"],

    // Gaming & Fitness
    "game": ["gaming", "gamer"],
    "gaming": ["gaming", "gamer", "arcade"],
    "gym": ["gym", "fitness", "workout"],
    "workout": ["fitness", "workout", "energy"],
    "books": ["books", "reading", "author"],
    "reading": ["books", "reading", "library"]
};

const PLURAL_VARIANTS = {
    "founders": "founder",
    "startups": "startup",
    "developers": "developer",
    "placements": "placement",
    "exams": "exam",
    "friends": "friend",
    "talks": "talk",
    "chats": "chat",
    "couples": "couple",
    "games": "game"
};

module.exports = {
    KEYWORD_DICTIONARY,
    PLURAL_VARIANTS
};
