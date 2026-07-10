#!/usr/bin/env node
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');

const NUM = Number(process.env.NUM_USERS || 200);
const START_ID = Number(process.env.START_USER_ID || 20000);

async function run() {
  await connectDB();
  console.log('Creating ' + NUM + ' test users starting at id ' + START_ID + '...');
  for (let i = 0; i < NUM; i++) {
    const id = START_ID + i;
    const email = 'loaduser' + id + '@example.com';
    const username = 'load' + id;
    try {
      const exists = await User.findOne({ id }).lean();
      if (exists) {
        console.log('user id ' + id + ' exists, skipping');
        continue;
      }
      await User.create({ id, email, username, role: 'user' });
      if (i % 50 === 0) process.stdout.write('.');
    } catch (e) {
      console.error('create user error', e && e.message ? e.message : e);
    }
  }
  console.log('\nDone');
  process.exit(0);
}

run().catch((err) => {
  console.error('fatal', err);
  process.exit(2);
});
