const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { URL } = require('url');
const { connectDB } = require('../src/config/db');
const User = require('../src/models/user.model');
const authService = require('../src/services/auth.service');
const { signAuthToken } = require('../src/utils/authToken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-security-smoke-secret';
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '15m';
process.env.ALLOW_DEV_OTP_BYPASS = process.env.ALLOW_DEV_OTP_BYPASS || 'true';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5000';
const base = new URL(BASE_URL);
const host = base.hostname;
const port = Number(base.port || (base.protocol === 'https:' ? 443 : 80));

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers
        }
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (_) {
            parsed = data;
          }
          resolve({ statusCode: res.statusCode, body: parsed, headers: res.headers });
        });
      }
    );

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getCookie(headers, name) {
  const setCookie = headers['set-cookie'] || [];
  const cookieString = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie || '');
  const match = cookieString.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function createTestEmail() {
  return `smoke-${Date.now()}-${crypto.randomInt(1000, 9999)}@example.com`;
}

async function createAuthenticatedSession() {
  const userId = Number(`${Date.now()}${crypto.randomInt(100, 999)}`);
  const email = createTestEmail();
  const username = `smokeuser${crypto.randomInt(10000, 99999)}`;
  const user = await User.create({
    id: userId,
    email,
    username,
    role: 'user',
    tokenVersion: 0
  });
  return {
    token: signAuthToken({ userId: user.id, email: user.email, username: user.username, role: user.role, tokenVersion: user.tokenVersion }),
    user
  };
}

async function main() {
  await connectDB();

  const results = [];
  const push = (name, ok, details) => results.push({ name, ok, details });

  try {
    const health = await request('GET', '/health');
    push('health endpoint', health.statusCode === 200, `status=${health.statusCode}`);
  } catch (err) {
    push('health endpoint', false, err.message);
  }

  const email = createTestEmail();
  try {
    const otpRes = await request('POST', '/api/auth/request-otp', { email, intent: 'signup' });
    push('request-otp accepts input', otpRes.statusCode === 200 || otpRes.statusCode === 503, `status=${otpRes.statusCode} body=${JSON.stringify(otpRes.body)}`);
  } catch (err) {
    push('request-otp accepts input', false, err.message);
  }

  try {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request('POST', '/api/auth/request-otp', { email, intent: 'signup' });
      statuses.push(res.statusCode);
    }
    const rateLimited = statuses.some((code) => code === 429);
    push('request-otp rate limiting', rateLimited || statuses.every((code) => code >= 400), `statuses=${statuses.join(',')}`);
  } catch (err) {
    push('request-otp rate limiting', false, err.message);
  }

  try {
    const invalidOtpRes = await request('POST', '/api/auth/verify-otp', { email, otp: '000000', username: 'smokesecuser' });
    push('invalid otp rejected', invalidOtpRes.statusCode === 400 || invalidOtpRes.statusCode === 429, `status=${invalidOtpRes.statusCode} body=${JSON.stringify(invalidOtpRes.body)}`);
  } catch (err) {
    push('invalid otp rejected', false, err.message);
  }

  try {
    const expiredJwt = jwt.sign({ userId: 1, tokenVersion: 0, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    const protectedRes = await request('GET', '/api/users/me', undefined, { Authorization: `Bearer ${expiredJwt}` });
    push('expired jwt denied', protectedRes.statusCode === 401, `status=${protectedRes.statusCode} body=${JSON.stringify(protectedRes.body)}`);
  } catch (err) {
    push('expired jwt denied', false, err.message);
  }

  try {
    const tamperedJwt = jwt.sign({ userId: 1, tokenVersion: 999, role: 'user' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
    const protectedRes = await request('GET', '/api/users/me', undefined, { Authorization: `Bearer ${tamperedJwt}` });
    push('tampered jwt denied', protectedRes.statusCode === 401, `status=${protectedRes.statusCode} body=${JSON.stringify(protectedRes.body)}`);
  } catch (err) {
    push('tampered jwt denied', false, err.message);
  }

  try {
    const protectedRes = await request('GET', '/api/messages/999999');
    push('unauthorized message access denied', protectedRes.statusCode === 401, `status=${protectedRes.statusCode} body=${JSON.stringify(protectedRes.body)}`);
  } catch (err) {
    push('unauthorized message access denied', false, err.message);
  }

  try {
    const protectedRes = await request('GET', '/api/messages/999999', undefined, { Authorization: 'Bearer invalid-token' });
    push('invalid bearer token denied', protectedRes.statusCode === 401, `status=${protectedRes.statusCode} body=${JSON.stringify(protectedRes.body)}`);
  } catch (err) {
    push('invalid bearer token denied', false, err.message);
  }

  try {
    const session = await createAuthenticatedSession();
    const meRes = await request('GET', '/api/users/me', undefined, { Authorization: `Bearer ${session.token}` });
    push('authenticated session can access own profile', meRes.statusCode === 200, `status=${meRes.statusCode} body=${JSON.stringify(meRes.body)}`);

    const messageRes = await request('GET', '/api/messages/999999', undefined, { Authorization: `Bearer ${session.token}` });
    push('authenticated user cannot access unrelated message resource', messageRes.statusCode !== 200, `status=${messageRes.statusCode} body=${JSON.stringify(messageRes.body)}`);

    const conversationRes = await request('GET', '/api/conversations/999999', undefined, { Authorization: `Bearer ${session.token}` });
    push('authenticated user cannot access unrelated conversation resource', conversationRes.statusCode === 401 || conversationRes.statusCode === 404, `status=${conversationRes.statusCode} body=${JSON.stringify(conversationRes.body)}`);
  } catch (err) {
    push('authenticated session security checks', false, err.message);
  }

  console.log('Security smoke test results:');
  for (const item of results) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}: ${item.details}`);
  }
  const failed = results.filter((item) => !item.ok).length;
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Smoke test runner failed:', err);
  process.exit(1);
});
