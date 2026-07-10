const ConfessionRoomMember = require('../models/confessionRoomMember.model');
const {
    mightHaveRoomAlias
} = require('./bloomFilter.service');

const ADJECTIVES = [
    'Silent', 'Hidden', 'Curious', 'Brave', 'Calm', 'Fuzzy', 'Clever', 'Wild', 'Gentle', 'Misty',
    'Rapid', 'Serene', 'Lively', 'Nimble', 'Bold', 'Cosmic', 'Bright', 'Quiet', 'Amber', 'Velvet'
];

const ANIMALS = [
    'Tiger', 'Falcon', 'Otter', 'Fox', 'Panda', 'Raven', 'Dolphin', 'Lynx', 'Wolf', 'Sparrow',
    'Leopard', 'Koala', 'Eagle', 'Hawk', 'Seal', 'Jaguar', 'Panther', 'Manta', 'Cobra', 'Orca'
];

function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function createAliasCandidate() {
    const suffix = Math.floor(10 + Math.random() * 90);
    return `${randomFrom(ADJECTIVES)}${randomFrom(ANIMALS)}${suffix}`;
}

async function generateUniqueAlias(roomId, maxAttempts = 40) {
    const rid = Number(roomId);
    for (let i = 0; i < maxAttempts; i++) {
        const alias = createAliasCandidate();
        if (!mightHaveRoomAlias(rid, alias)) return alias;
        const existing = await ConfessionRoomMember.exists({ roomId: rid, alias });
        if (!existing) return alias;
    }
    throw new Error('Failed to generate unique alias');
}

module.exports = {
    generateUniqueAlias
};
