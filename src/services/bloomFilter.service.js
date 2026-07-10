const crypto = require('crypto');

const User = require('../models/user.model');
const ConfessionRoom = require('../models/confessionRoom.model');
const ConfessionRoomMember = require('../models/confessionRoomMember.model');
const Conversation = require('../models/conversation.model');
const ChatRequest = require('../models/chatRequest.model');
const Message = require('../models/message.model');
const ConfessionContentFingerprint = require('../models/confessionContentFingerprint.model');

class BloomFilter {
    constructor({ name, sizeBits = 1048576, hashCount = 7 } = {}) {
        this.name = name || 'bloom';
        this.sizeBits = Math.max(8, Math.floor(sizeBits));
        this.hashCount = Math.max(1, Math.floor(hashCount));
        this.bytes = new Uint8Array(Math.ceil(this.sizeBits / 8));
    }

    clear() {
        this.bytes.fill(0);
    }

    _hashes(value) {
        const text = String(value || '');
        const digest = crypto.createHash('sha256').update(text).digest();
        const h1 = digest.readUInt32BE(0);
        let h2 = digest.readUInt32BE(4);
        if (!h2) h2 = 0x9e3779b1;

        const positions = [];
        for (let i = 0; i < this.hashCount; i += 1) {
            const position = (h1 + (i * h2)) % this.sizeBits;
            positions.push(position < 0 ? position + this.sizeBits : position);
        }
        return positions;
    }

    _setBit(position) {
        const byteIndex = Math.floor(position / 8);
        const bitIndex = position % 8;
        this.bytes[byteIndex] |= (1 << bitIndex);
    }

    _getBit(position) {
        const byteIndex = Math.floor(position / 8);
        const bitIndex = position % 8;
        return (this.bytes[byteIndex] & (1 << bitIndex)) !== 0;
    }

    add(value) {
        if (value === undefined || value === null || value === '') return;
        for (const position of this._hashes(value)) {
            this._setBit(position);
        }
    }

    mightHave(value) {
        if (value === undefined || value === null || value === '') return false;
        for (const position of this._hashes(value)) {
            if (!this._getBit(position)) return false;
        }
        return true;
    }
}

const filters = {
    email: new BloomFilter({ name: 'email', sizeBits: 1048576, hashCount: 7 }),
    username: new BloomFilter({ name: 'username', sizeBits: 1048576, hashCount: 7 }),
    joinCode: new BloomFilter({ name: 'joinCode', sizeBits: 524288, hashCount: 6 }),
    roomAlias: new BloomFilter({ name: 'roomAlias', sizeBits: 1048576, hashCount: 7 }),
    dmConversation: new BloomFilter({ name: 'dmConversation', sizeBits: 1048576, hashCount: 7 }),
    chatRequest: new BloomFilter({ name: 'chatRequest', sizeBits: 1048576, hashCount: 7 }),
    clientMessageId: new BloomFilter({ name: 'clientMessageId', sizeBits: 1048576, hashCount: 7 }),
    fingerprint: new BloomFilter({ name: 'fingerprint', sizeBits: 1048576, hashCount: 7 })
};

let bloomReady = false;

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeAlias(value) {
    return String(value || '').trim().toLowerCase();
}

function makeDmKey(userA, userB) {
    const first = Number(userA);
    const second = Number(userB);
    if (!first || !second) return '';
    const [low, high] = first < second ? [first, second] : [second, first];
    return `dm:${low}:${high}`;
}

function makeChatRequestKey({ requesterUserId, targetUserId, confessionId, contextType }) {
    const requester = Number(requesterUserId);
    const target = Number(targetUserId);
    if (!requester || !target) return '';
    return `chat:${requester}:${target}:${Number(confessionId) || 0}:${String(contextType || 'confession').trim().toLowerCase()}`;
}

function makeRoomAliasKey(roomId, alias) {
    const rid = Number(roomId);
    const normalizedAlias = normalizeAlias(alias);
    if (!rid || !normalizedAlias) return '';
    return `alias:${rid}:${normalizedAlias}`;
}

function makeFingerprintKey({ userId, roomId, type, hash }) {
    const uid = Number(userId);
    const rid = Number(roomId);
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedHash = String(hash || '').trim().toLowerCase();
    if (!uid || !rid || !normalizedType || !normalizedHash) return '';
    return `fp:${uid}:${rid}:${normalizedType}:${normalizedHash}`;
}

function remember(filterName, value) {
    const filter = filters[filterName];
    if (!filter) return;
    filter.add(value);
}

function mightHave(filterName, value) {
    if (!bloomReady) return true;
    const filter = filters[filterName];
    if (!filter) return false;
    return filter.mightHave(value);
}

function rememberEmail(email) {
    remember('email', normalizeEmail(email));
}

function rememberUsername(username) {
    remember('username', normalizeUsername(username));
}

function rememberJoinCode(joinCode) {
    remember('joinCode', String(joinCode || '').trim());
}

function rememberRoomAlias(roomId, alias) {
    remember('roomAlias', makeRoomAliasKey(roomId, alias));
}

function rememberDMConversation(userA, userB) {
    remember('dmConversation', makeDmKey(userA, userB));
}

function rememberChatRequest(payload) {
    remember('chatRequest', makeChatRequestKey(payload || {}));
}

function rememberClientMessageId(clientMessageId) {
    remember('clientMessageId', String(clientMessageId || '').trim());
}

function rememberFingerprint(payload) {
    remember('fingerprint', makeFingerprintKey(payload || {}));
}

function mightHaveEmail(email) {
    return mightHave('email', normalizeEmail(email));
}

function mightHaveUsername(username) {
    return mightHave('username', normalizeUsername(username));
}

function mightHaveJoinCode(joinCode) {
    return mightHave('joinCode', String(joinCode || '').trim());
}

function mightHaveRoomAlias(roomId, alias) {
    return mightHave('roomAlias', makeRoomAliasKey(roomId, alias));
}

function mightHaveDMConversation(userA, userB) {
    return mightHave('dmConversation', makeDmKey(userA, userB));
}

function mightHaveChatRequest(payload) {
    return mightHave('chatRequest', makeChatRequestKey(payload || {}));
}

function mightHaveClientMessageId(clientMessageId) {
    return mightHave('clientMessageId', String(clientMessageId || '').trim());
}

function mightHaveFingerprint(payload) {
    return mightHave('fingerprint', makeFingerprintKey(payload || {}));
}

async function initializeBloomFilters() {
    bloomReady = false;
    for (const filter of Object.values(filters)) {
        filter.clear();
    }

    const [users, rooms, members, conversations, chatRequests, messages, fingerprints] = await Promise.all([
        User.find({})
            .select({ _id: 0, email: 1, username: 1 })
            .lean(),
        ConfessionRoom.find({})
            .select({ _id: 0, joinCode: 1 })
            .lean(),
        ConfessionRoomMember.find({})
            .select({ _id: 0, roomId: 1, alias: 1 })
            .lean(),
        Conversation.find({ type: 'dm' })
            .select({ _id: 0, participants: 1 })
            .lean(),
        ChatRequest.find({})
            .select({ _id: 0, requesterUserId: 1, targetUserId: 1, confessionId: 1, contextType: 1 })
            .lean(),
        Message.find({})
            .select({ _id: 0, clientMessageId: 1 })
            .lean(),
        ConfessionContentFingerprint.find({})
            .select({ _id: 0, userId: 1, roomId: 1, type: 1, hash: 1 })
            .lean()
    ]);

    for (const row of users) {
        rememberEmail(row && row.email);
        rememberUsername(row && row.username);
    }

    for (const row of rooms) {
        rememberJoinCode(row && row.joinCode);
    }

    for (const row of members) {
        rememberRoomAlias(row && row.roomId, row && row.alias);
    }

    for (const row of conversations) {
        const participants = Array.isArray(row && row.participants) ? row.participants : [];
        if (participants.length < 2) continue;
        rememberDMConversation(participants[0], participants[1]);
    }

    for (const row of chatRequests) {
        rememberChatRequest(row);
    }

    for (const row of messages) {
        rememberClientMessageId(row && row.clientMessageId);
    }

    for (const row of fingerprints) {
        rememberFingerprint(row);
    }

    bloomReady = true;
}

module.exports = {
    initializeBloomFilters,
    rememberEmail,
    rememberUsername,
    rememberJoinCode,
    rememberRoomAlias,
    rememberDMConversation,
    rememberChatRequest,
    rememberClientMessageId,
    rememberFingerprint,
    mightHaveEmail,
    mightHaveUsername,
    mightHaveJoinCode,
    mightHaveRoomAlias,
    mightHaveDMConversation,
    mightHaveChatRequest,
    mightHaveClientMessageId,
    mightHaveFingerprint,
    makeFingerprintKey
};
