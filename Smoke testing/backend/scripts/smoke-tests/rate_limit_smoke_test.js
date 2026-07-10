process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-should-be-very-long-and-random-123456';
process.env.API_RATE_LIMIT_USER_MAX = process.env.API_RATE_LIMIT_USER_MAX || '3';
process.env.API_RATE_LIMIT_USER_WINDOW_MS = process.env.API_RATE_LIMIT_USER_WINDOW_MS || String(60 * 1000);
process.env.API_RATE_LIMIT_IP_MAX = process.env.API_RATE_LIMIT_IP_MAX || '5';
process.env.API_RATE_LIMIT_IP_WINDOW_MS = process.env.API_RATE_LIMIT_IP_WINDOW_MS || String(60 * 1000);
process.env.TRUST_PROXY = process.env.TRUST_PROXY || 'false';

const express = require('express');
const http = require('http');
const axios = require('axios');
const auth = require('../src/utils/authToken');

function getRateLimitMiddleware() {
  const path = require.resolve('../src/middleware/rateLimit.middleware');
  delete require.cache[path];
  return require('../src/middleware/rateLimit.middleware');
}

console.log('ENV', {
  JWT_SECRET: Boolean(process.env.JWT_SECRET),
  API_RATE_LIMIT_USER_MAX: process.env.API_RATE_LIMIT_USER_MAX,
  API_RATE_LIMIT_USER_WINDOW_MS: process.env.API_RATE_LIMIT_USER_WINDOW_MS,
  API_RATE_LIMIT_IP_MAX: process.env.API_RATE_LIMIT_IP_MAX,
  API_RATE_LIMIT_IP_WINDOW_MS: process.env.API_RATE_LIMIT_IP_WINDOW_MS,
  TRUST_PROXY: process.env.TRUST_PROXY
});

function createRateLimitApp() {
  const { hydrateRateLimitIdentity, apiUserLimiter, apiIpLimiter } = getRateLimitMiddleware();
  const app = express();
  app.use(express.json());
  app.use(hydrateRateLimitIdentity);
  app.use(apiUserLimiter);
  app.use(apiIpLimiter);
  app.get('/smoke-rate-limit', (req, res) => {
    res.json({ ok: true, userId: req.rateLimitIdentity?.userId || null, ip: req.ip, rateLimit: req.rateLimit || null });
  });
  return app;
}

function createToken(userId, email, username) {
  return auth.signAuthToken({ userId, email, username });
}

async function sendRequest(client, count, label) {
  const results = [];

  for (let i = 0; i < count; i += 1) {
    try {
      const response = await client.get('/smoke-rate-limit');
      results.push({ index: i, status: response.status, data: response.data });
      console.log(`${label} ${i} -> ${response.status}`, response.data);
    } catch (err) {
      const status = err.response?.status || 'ERR';
      const retryAfter = err.response?.headers?.['retry-after'];
      results.push({ index: i, status, retryAfter });
      console.log(`${label} ${i} -> ${status}${retryAfter ? ` retry-after=${retryAfter}` : ''}`);
    }
  }

  return results;
}

async function withServer(app, callback) {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const port = server.address().port;
  const baseURL = `http://127.0.0.1:${port}`;
  try {
    return await callback(baseURL);
  } finally {
    server.close();
  }
}

async function run() {
  console.log('Running unauthenticated IP limit smoke test');
  await withServer(createRateLimitApp(), async (baseURL) => {
    const unauthClient = axios.create({ baseURL });
    const unauthResults = await sendRequest(unauthClient, 6, 'unauth');
    const unauth429 = unauthResults.filter((r) => r.status === 429);
    const unauthSuccess = unauthResults.filter((r) => r.status === 200);

    if (unauthSuccess.length !== 5 || unauth429.length !== 1) {
      throw new Error(`Expected 5 successful and 1 rate-limited request for unauthenticated IP. Got ${unauthSuccess.length} success, ${unauth429.length} 429.`);
    }

    if (!unauth429[0].retryAfter) {
      throw new Error('Expected Retry-After header on unauthenticated 429 response');
    }

    console.log('Unauthenticated IP limit behaved as expected');
  });

  console.log('Running authenticated per-user limit smoke test');
  await withServer(createRateLimitApp(), async (baseURL) => {
    const user1Token = createToken(1001, 'smoke1@example.com', 'smoke1');
    const user1Client = axios.create({ baseURL, headers: { Authorization: `Bearer ${user1Token}` } });
    const user1Results = await sendRequest(user1Client, 4, 'user1');
    const user1Success = user1Results.filter((r) => r.status === 200);
    const user1429 = user1Results.filter((r) => r.status === 429);

    if (user1Success.length !== 3 || user1429.length !== 1) {
      throw new Error(`Expected 3 successful and 1 rate-limited request for user1. Got ${user1Success.length} success, ${user1429.length} 429.`);
    }

    if (!user1429[0].retryAfter) {
      throw new Error('Expected Retry-After header on authenticated user 429 response');
    }

    console.log('Authenticated per-user limit behaved as expected');
  });

  console.log('Running combined per-user and shared-IP limit smoke test');
  await withServer(createRateLimitApp(), async (baseURL) => {
    const user1Token = createToken(1001, 'smoke1@example.com', 'smoke1');
    const user2Token = createToken(1002, 'smoke2@example.com', 'smoke2');
    const user1Client = axios.create({ baseURL, headers: { Authorization: `Bearer ${user1Token}` } });
    const user2Client = axios.create({ baseURL, headers: { Authorization: `Bearer ${user2Token}` } });

    const user1Results = await sendRequest(user1Client, 3, 'user1');
    const user1Success = user1Results.filter((r) => r.status === 200).length;
    const user1429 = user1Results.filter((r) => r.status === 429).length;
    if (user1Success !== 3 || user1429 !== 0) {
      throw new Error(`Expected user1 to have 3 successful requests before user limit. Got ${user1Success} success, ${user1429} 429.`);
    }

    const user2Results = await sendRequest(user2Client, 3, 'user2');
    const user2SuccessfulCount = user2Results.filter((r) => r.status === 200).length;
    const user2RateLimitCount = user2Results.filter((r) => r.status === 429).length;

    if (user2SuccessfulCount !== 2 || user2RateLimitCount !== 1) {
      throw new Error(`Expected user2 to reach shared IP limit after 2 more requests. Got ${user2SuccessfulCount} success, ${user2RateLimitCount} 429.`);
    }

    console.log('Shared-IP + user limits behaved as expected');
  });

  console.log('All rate-limit smoke checks passed');
}

run().catch((err) => {
  console.error('Rate limit smoke test failed:');
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
