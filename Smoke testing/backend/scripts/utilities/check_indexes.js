#!/usr/bin/env node
const { connectDB, mongoose } = require('../src/config/db');
const Message = require('../src/models/message.model');

async function run() {
  try {
    await connectDB();
    console.log('Connected to MongoDB. Fetching indexes for collection:', Message.collection.name);
    const indexes = await Message.collection.indexes();
    console.log('Indexes:');
    for (const idx of indexes) {
      console.log(JSON.stringify(idx));
    }
    // Quick checks
    const hasClientIdx = indexes.some((i) => i.key && i.key.clientMessageId === 1 && i.unique);
    const hasTtl = indexes.some((i) => i.key && i.key.expiresAt === 1 && i.expireAfterSeconds === 0);
    console.log('\nChecks:');
    console.log('clientMessageId unique index:', hasClientIdx);
    console.log('expiresAt TTL index (expireAfterSeconds=0):', hasTtl);
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('Error checking indexes:', err && err.message ? err.message : err);
    process.exit(2);
  }
}

run();
