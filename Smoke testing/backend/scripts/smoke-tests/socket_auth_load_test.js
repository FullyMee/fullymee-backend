#!/usr/bin/env node
const { io } = require('socket.io-client');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const { signAuthToken } = require('../src/utils/authToken');

const BASE = process.env.BASE_URL || 'http://localhost:5010';
const NUM_CLIENTS = Number(process.env.NUM_CLIENTS || 200);
const START_ID = Number(process.env.START_USER_ID || 20000);
const CONNECTION_BATCH_DELAY_MS = Number(process.env.CONN_BATCH_DELAY_MS || 5);

async function run() {
  await connectDB();
  const tokens = [];
  for (let i = 0; i < NUM_CLIENTS; i++) {
    const id = START_ID + i;
    const user = await User.findOne({ id }).lean();
    if (!user) continue;
    const token = signAuthToken({ userId: user.id, email: user.email, username: user.username, role: user.role });
    tokens.push({ id: user.id, token });
  }

  console.log('Attempting', tokens.length, 'socket connections to', BASE);
  let connected = 0;
  let failed = 0;
  const sockets = [];

  for (const t of tokens) {
    const socket = io(BASE, { auth: { token: t.token }, transports: ['websocket'], reconnection: false });
    sockets.push(socket);
    socket.on('connect', () => {
      connected++;
    });
    socket.on('connect_error', (err) => {
      failed++;
    });
    await new Promise((r) => setTimeout(r, CONNECTION_BATCH_DELAY_MS));
  }

  // wait a bit
  await new Promise((r) => setTimeout(r, 5000));
  console.log('Connected:', connected, 'Failed:', failed);

  for (const s of sockets) try { s.disconnect(); } catch (e) {}
  process.exit(0);
}

run().catch((err) => {
  console.error('socket load test failed', err && err.message ? err.message : err);
  process.exit(2);
});
