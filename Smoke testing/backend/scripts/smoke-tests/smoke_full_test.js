const axios = require('axios');
const auth = require('../src/utils/authToken');

const BASE = process.env.BASE_URL || 'http://localhost:5002';

function tokenFor(userId, email, username) {
  return auth.signAuthToken({ userId, email, username });
}

async function run() {
  try {
    const t1 = tokenFor(1001, 'smoke1@example.com', 'smoke1');
    const t2 = tokenFor(1002, 'smoke2@example.com', 'smoke2');

    const a1 = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${t1}` } });
    const a2 = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${t2}` } });

    console.log('Joined room 24 as user1');
    await a1.post('/api/confessions/rooms/join', { roomId: 24 });
    // brief pause to allow server to settle after recent restarts
    await new Promise((r) => setTimeout(r, 500));

    console.log('User1 posts a confession');
    const postRes = await a1.post('/api/confessions/rooms/24/confessions', { content: 'smoke confession 1' });
    const confessionId = (postRes.data && (postRes.data.confessionId || (postRes.data.confession && postRes.data.confession.confessionId))) || null;
    console.log('postResp', confessionId || postRes.data);

    console.log('User2 joins and replies');
    await a2.post('/api/confessions/rooms/join', { roomId: 24 });
    await new Promise((r) => setTimeout(r, 250));
    const replyRes = await a2.post(`/api/confessions/rooms/24/confessions/${confessionId}/replies`, { content: 'smoke reply' });
    console.log('replyResp', replyRes.data);

    console.log('User1 likes confession');
    await a1.post(`/api/confessions/${confessionId}/like`);

    console.log('Chat request from user2 to user1');
    const chatReq = await a2.post(`/api/confessions/rooms/24/confessions/${confessionId}/chat-request`);
    console.log('chatReq', chatReq.data);

    console.log('User1 accepts chat request');
    const reqId = chatReq.data.requestId || chatReq.data.id || null;
    if (reqId) {
      const resp = await a1.post(`/api/conversations/requests/${reqId}/respond`, { action: 'accept' });
      console.log('acceptResp', resp.data);
      const convId = resp.data.conversationId;

      console.log('User1 sends a DM');
      await a1.post('/api/messages/send', { conversationId: convId, content: 'hello from user1', clientMessageId: 'c1' });

      console.log('User2 fetches messages');
      const msgs = await a2.get(`/api/messages/${convId}`);
      console.log('messages count', Array.isArray(msgs.data) ? msgs.data.length : 'n/a');
    }

    console.log('Rate-limit test (rapid posts)');
    for (let i = 0; i < 8; i++) {
      try {
        const r = await a1.post('/api/confessions/rooms/24/confessions', { content: `spam ${i}` });
        console.log('spam', i, 'ok');
      } catch (err) {
        const status = err.response && err.response.status;
        const ra = err.response && err.response.headers && err.response.headers['retry-after'];
        console.log('spam', i, 'failed', status, ra || 'no-retry-after');
        if (status === 429) break;
      }
    }

    console.log('Smoke test completed');
  } catch (err) {
    console.error('Smoke test error');
    if (err && err.response) {
      console.error('response data:', err.response.data);
      console.error('status:', err.response.status);
      console.error('headers:', err.response.headers);
    } else {
      console.error(err && err.stack ? err.stack : err);
    }
    process.exit(2);
  }
}

run();
