import http from 'http';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.VITE_API_URL = process.env.VITE_API_URL || 'http://127.0.0.1:5300/api';
process.env.API_RATE_LIMIT_USER_MAX = process.env.API_RATE_LIMIT_USER_MAX || '10';
process.env.API_RATE_LIMIT_USER_WINDOW_MS = process.env.API_RATE_LIMIT_USER_WINDOW_MS || String(60 * 1000);
process.env.API_RATE_LIMIT_IP_MAX = process.env.API_RATE_LIMIT_IP_MAX || '10';
process.env.API_RATE_LIMIT_IP_WINDOW_MS = process.env.API_RATE_LIMIT_IP_WINDOW_MS || String(60 * 1000);
process.env.TRUST_PROXY = process.env.TRUST_PROXY || 'false';

const frontendApiPath = pathToFileURL(path.resolve(__dirname, '../../frontend/src/services/api.js')).href;
const expressModule = await import('express');
const express = expressModule.default || expressModule;
const app = express();

let retryAttempts = 0;
app.get('/api/frontend-retry-test', (req, res) => {
  retryAttempts += 1;
  if (retryAttempts <= 2) {
    return res.status(429).set('Retry-After', '1').json({ error: 'Too many requests' });
  }
  return res.json({ ok: true, retryAttempts });
});

const server = http.createServer(app);
const port = Number(process.env.TEST_SERVER_PORT || 5300);

await new Promise((resolve, reject) => {
  server.listen(port, '127.0.0.1', () => resolve());
  server.on('error', reject);
});

const frontendApi = await import(frontendApiPath);
const api = frontendApi.default || frontendApi;

try {
  console.log('Frontend retry smoke test starting against backend app route');
  const payload = await api.apiRequest('/frontend-retry-test', {
    method: 'GET',
    retryOptions: {
      retries: 4,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitterFactor: 0.1,
      retryMethods: ['GET'],
      retryStatusCodes: [429]
    }
  });

  if (!payload || payload.ok !== true || payload.retryAttempts !== 3) {
    throw new Error(`Unexpected success payload: ${JSON.stringify(payload)}`);
  }

  console.log('Frontend retry behavior succeeded', payload);
  console.log('Test passed: frontend retries 429 responses until success');
} catch (err) {
  console.error('Frontend retry smoke test failed:', err && err.stack ? err.stack : err);
  process.exit(1);
} finally {
  server.close();
}
