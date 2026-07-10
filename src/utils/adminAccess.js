let cachedRaw = null;
let cachedAdminIdSet = new Set();

function parseConfiguredAdminIds(rawValue) {
    const nextSet = new Set();
    const values = String(rawValue || '')
        .split(',')
        .map((value) => Number(String(value).trim()))
        .filter((value) => Number.isInteger(value) && value > 0);

    for (const value of values) {
        nextSet.add(value);
    }

    return nextSet;
}

function getConfiguredAdminIdSet() {
    const raw = String(process.env.ADMIN_USER_IDS || '').trim();
    if (raw === cachedRaw) {
        return cachedAdminIdSet;
    }

    cachedRaw = raw;
    cachedAdminIdSet = parseConfiguredAdminIds(raw);
    return cachedAdminIdSet;
}

function isConfiguredAdminUser(userId) {
    const numericUserId = Number(userId);
    if (!Number.isInteger(numericUserId) || numericUserId <= 0) {
        return false;
    }

    return getConfiguredAdminIdSet().has(numericUserId);
}

module.exports = {
    getConfiguredAdminIdSet,
    isConfiguredAdminUser
};
