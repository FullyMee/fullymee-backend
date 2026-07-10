#!/usr/bin/env node
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const { signAuthToken } = require('../src/utils/authToken');
const fetch = require('node-fetch');

async function run() {
  await connectDB();
  const id = Number(process.env.TEST_USER_ID || 20000);
  const user = await User.findOne({ id }).lean();
  if (!user) {
    console.error('user not found', id);
    process.exit(2);
  }

  const token = signAuthToken({ userId: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: user.tokenVersion });
  console.log('ISSUED_TOKEN_START');
  console.log(token);
  console.log('ISSUED_TOKEN_END');

  const url = process.env.BASE_URL || 'http://localhost:5010';
  const endpoint = url + '/api/auth/users';

  const res1 = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
  console.log('FIRST_STATUS', res1.status);
  const body1 = await res1.text();
  console.log('FIRST_BODY_START');
  console.log(body1.slice(0, 2000));
  console.log('FIRST_BODY_END');

  await User.updateOne({ id }, { $inc: { tokenVersion: 1 } });
  console.log('INCREMENTED_TOKEN_VERSION');

  const res2 = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
  console.log('SECOND_STATUS', res2.status);
  const body2 = await res2.text();
  console.log('SECOND_BODY_START');
  console.log(body2.slice(0, 2000));
  console.log('SECOND_BODY_END');

  process.exit(0);
}

run().catch((err) => {
  console.error('revocation test failed', err && err.stack ? err.stack : err);
  process.exit(2);
});
