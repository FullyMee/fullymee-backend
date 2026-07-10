const POSITIVE_WORDS = ['hope', 'thanks', 'thank you', 'support', 'love', 'care', 'healing', 'growth', 'better'];
const NEGATIVE_WORDS = ['hate', 'kill', 'die', 'worthless', 'ugly', 'stupid', 'trash', 'loser', 'suicide'];

const TOXIC_PATTERNS = [
    /\bidiot\b/i,
    /\bmoron\b/i,
    /\bstupid\b/i,
    /\btrash\b/i,
    /\bworthless\b/i,
    /\bfreak\b/i
];

const HATE_PATTERNS = [
    /\bnazi\b/i,
    /\bracist\b/i,
    /\blynch\b/i
];

const SEXUAL_PATTERNS = [
    /\bexplicit\b/i,
    /\bnsfw\b/i,
    /\bsexual\b/i
];

const SELF_HARM_PATTERNS = [
    /\bsuicide\b/i,
    /\bkill myself\b/i,
    /\bself harm\b/i,
    /\bend my life\b/i
];

const THREAT_PATTERNS = [
    /\bi will kill\b/i,
    /\bshoot\b/i,
    /\battack\b/i,
    /\bhurt you\b/i,
    /\bbomb\b/i
];

function countMatches(patterns, text) {
    return patterns.reduce((sum, pattern) => (pattern.test(text) ? sum + 1 : sum), 0);
}

function getSentimentScore(text) {
    const normalized = String(text || '').toLowerCase();
    let score = 0;

    for (const word of POSITIVE_WORDS) {
        if (normalized.includes(word)) score += 1;
    }

    for (const word of NEGATIVE_WORDS) {
        if (normalized.includes(word)) score -= 1;
    }

    if (score > 5) return 5;
    if (score < -5) return -5;
    return score;
}

function moderateContent(content) {
    const text = String(content || '');
    const reasons = [];
    const categories = [];
    let severity = 'green';
    let action = 'allow';

    const toxicityHits = countMatches(TOXIC_PATTERNS, text);
    const hateHits = countMatches(HATE_PATTERNS, text);
    const sexualHits = countMatches(SEXUAL_PATTERNS, text);
    const selfHarmHits = countMatches(SELF_HARM_PATTERNS, text);
    const threatHits = countMatches(THREAT_PATTERNS, text);
    const sentimentScore = getSentimentScore(text);

    if (toxicityHits > 0) {
        categories.push('toxicity');
        reasons.push('toxic_language_detected');
    }
    if (hateHits > 0) {
        categories.push('hate_speech');
        reasons.push('hate_speech_detected');
    }
    if (sexualHits > 0) {
        categories.push('sexual_explicit');
        reasons.push('sexual_content_detected');
    }
    if (selfHarmHits > 0) {
        categories.push('self_harm');
        reasons.push('self_harm_detected');
    }
    if (threatHits > 0) {
        categories.push('threat');
        reasons.push('threat_detected');
    }

    if (selfHarmHits > 0 || threatHits > 0) {
        severity = 'red';
        action = 'block';
    } else if (hateHits > 0 && toxicityHits > 0) {
        severity = 'red';
        action = 'block';
    } else if (hateHits > 0 || sexualHits > 0 || toxicityHits >= 2 || sentimentScore <= -4) {
        severity = 'yellow';
        action = 'flag';
    }

    const moderationStatus = action === 'block'
        ? 'blocked'
        : (action === 'flag' ? 'flagged' : 'approved');

    let userWarning = '';
    if (severity === 'yellow') {
        userWarning = 'Your post is published but flagged for review due to policy-sensitive content.';
    } else if (severity === 'red') {
        userWarning = 'Your post could not be published because it violates safety policy.';
    }

    return {
        severity,
        action,
        moderationStatus,
        reasons,
        categories,
        sentimentScore,
        escalationRequired: severity === 'red',
        userWarning
    };
}

module.exports = { moderateContent };
