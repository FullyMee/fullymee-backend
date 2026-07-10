#!/usr/bin/env node
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const { signAuthToken } = require('../src/utils/authToken');

const fetch = global.fetch || require('node-fetch');

const BASE = process.env.BASE_URL || 'http://localhost:5010';
const NUM_USERS = Number(process.env.NUM_USERS || 200);
const START_ID = Number(process.env.START_USER_ID || 20000);
const CONCURRENCY = Number(process.env.CONCURRENCY || 50);

async function run() {
  await connectDB();
  console.log('Preparing tokens for users...');
  const tokens = [];
  for (let i = 0; i < NUM_USERS; i++) {
    const id = START_ID + i;
    const user = await User.findOne({ id }).lean();
    if (!user) continue;
    const token = signAuthToken({ userId: user.id, email: user.email, username: user.username, role: user.role });
    tokens.push({ id: user.id, token });
  }

  console.log('Starting HTTP load test to', BASE + '/api/auth/users');
  const results = [];

  async function worker(batch) {
    for (const t of batch) {
      const start = Date.now();
      try {
        const res = await fetch(BASE + '/api/auth/users', { headers: { Authorization: 'Bearer ' + t.token } });
        const ok = res.status === 200;
        const latency = Date.now() - start;
        results.push({ ok, status: res.status, latency });
      } catch (e) {
        const latency = Date.now() - start;
        results.push({ ok: false, error: e && e.message ? e.message : e, latency });
      }
    }
  }

  // dispatch in concurrency
  const batches = [];
  for (let i = 0; i < tokens.length; i += Math.ceil(tokens.length / CONCURRENCY)) {
    batches.push(tokens.slice(i, i + Math.ceil(tokens.length / CONCURRENCY)));
  }

  await Promise.all(batches.map((b) => worker(b)));

  const okCount = results.filter((r) => r.ok).length;
  const latencies = results.map((r) => r.latency).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log('Results: total=', results.length, 'ok=', okCount);
  console.log('p50=', p50, 'p95=', p95, 'p99=', p99);
  process.exit(0);
}

run().catch((err) => {
  console.error('load test failed', err && err.message ? err.message : err);
  process.exit(2);
});
