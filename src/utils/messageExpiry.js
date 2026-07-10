function getMessageTtlMinutes() {
    const raw = Number(process.env.MESSAGE_TTL_MIN || 5);
    if (!Number.isFinite(raw) || raw <= 0) return 5;
    return raw;
}

function getMessageExpiryMs() {
    return getMessageTtlMinutes() * 60 * 1000;
}

function getMessageExpiresAt() {
    return new Date(Date.now() + getMessageExpiryMs());
}

module.exports = {
    getMessageTtlMinutes,
    getMessageExpiryMs,
    getMessageExpiresAt
};
