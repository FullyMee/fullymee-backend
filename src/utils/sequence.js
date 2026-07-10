const Counter = require('../models/counter.model');

// Simple in-process sequence pre-allocation to reduce DB contention.
// Reserves blocks of IDs (default BATCH_SIZE) from the Counter collection
// and serves them from memory until exhausted.
const POOLS = new Map();
const DEFAULT_BATCH_SIZE = 100;

async function refillPool(name, batchSize) {
    const inc = Number(batchSize) || DEFAULT_BATCH_SIZE;
    const counter = await Counter.findOneAndUpdate(
        { name },
        { $inc: { seq: inc } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const end = counter.seq;
    const start = end - inc + 1;
    POOLS.set(name, { next: start, end });
}

async function getNextSequence(name, opts = {}) {
    const batchSize = Number(opts.batchSize) || DEFAULT_BATCH_SIZE;

    let pool = POOLS.get(name);
    if (!pool || pool.next > pool.end) {
        await refillPool(name, batchSize);
        pool = POOLS.get(name);
    }

    const value = pool.next;
    pool.next += 1;
    return value;
}

async function setSequenceAtLeast(name, value) {
    await Counter.updateOne(
        { name },
        { $max: { seq: Number(value) || 0 } },
        { upsert: true }
    );
    // invalidate local pool so next call refills from at-least value
    POOLS.delete(name);
}

module.exports = { getNextSequence, setSequenceAtLeast };
