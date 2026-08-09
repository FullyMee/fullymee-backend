/**
 * Ambience Selector Service
 * Provides category key normalization used by createRoomInstance.
 * Auto-selection scoring logic has been removed — image selection is now user-driven.
 */

const CATEGORY_ALIASES = {
    'late_night': 'late_night',
    'latenight': 'late_night',
    'heartbreak': 'heartbreak',
    'anxiety': 'anxiety',
    'relationships': 'relationships',
    'relationship': 'relationships',
    'family': 'family',
    'college': 'college',
    'career': 'career',
    'tech_and_coding': 'tech_coding',
    'tech_coding': 'tech_coding',
    'casual_chats': 'casual_chat',
    'casual_chat': 'casual_chat',
    'confessions': 'confessions',
    'gaming': 'gaming',
    'entertainment': 'entertainment',
    'fitness': 'fitness',
    'finance': 'finance',
    'politics': 'politics',
    'startup': 'startups',
    'startups': 'startups',
    'travel': 'travel',
    'books': 'books',
    'advice': 'advice'
};

function normalizeCategoryKey(rawCategory) {
    if (!rawCategory) return 'late_night';
    const key = String(rawCategory)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    return CATEGORY_ALIASES[key] || key;
}

module.exports = {
    normalizeCategoryKey
};
