const { io } = require('socket.io-client');
const auth = require('../src/utils/authToken');
const { connectDB } = require('../src/config/db');
const Conversation = require('../src/models/conversation.model');
const { getNextSequence } = require('../src/utils/sequence');
const fs = require('fs');
const os = require('os');
const path = require('path');

// in-process resource monitor (writes to backend/stress_resource_log.csv)
const monitorOut = path.join(__dirname, '..', 'stress_resource_log.csv');
try { fs.writeFileSync(monitorOut, 'Timestamp,rss,freeMem,socketCount\n'); } catch (e) {}
let monitorInterval = null;

const BASE = process.env.BASE_URL || 'http://localhost:5003';
const NUM_CLIENTS = Number(process.env.NUM_CLIENTS || 50);
const MESSAGES_PER_CLIENT = Number(process.env.MESSAGES_PER_CLIENT || 20);
const MESSAGE_INTERVAL_MS = Number(process.env.MESSAGE_INTERVAL_MS || 200);
const START_USER_ID = Number(process.env.START_USER_ID || 10000);
const CONNECTION_BATCH_DELAY_MS = Number(process.env.CONN_BATCH_DELAY_MS || 5);

async function createConversation(participants) {
  const id = await getNextSequence('conversations');
  const doc = await Conversation.create({ id, type: 'group', participants });
  return doc.id;
}

function tokenFor(userId) {
  return auth.signAuthToken({ userId, email: `load${userId}@example.com`, username: `load${userId}` });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  console.log('Connecting to DB...');
  await connectDB();

  // start resource monitor
  monitorInterval = setInterval(() => {
    try {
      const rss = process.memoryUsage().rss || 0;
      const free = os.freemem() || 0;
      const socketCount = typeof sockets !== 'undefined' ? sockets.length : 0;
      const line = `${new Date().toISOString()},${rss},${free},${socketCount}\n`;
      fs.appendFileSync(monitorOut, line);
    } catch (e) {}
  }, 1000);

  const participants = [];
  for (let i = 0; i < NUM_CLIENTS; i++) participants.push(START_USER_ID + i);

  console.log(`Creating conversation for ${NUM_CLIENTS} participants...`);
  const conversationId = await createConversation(participants);
  console.log('Conversation id:', conversationId);
  const convoDoc = await Conversation.findOne({ id: conversationId }).lean();
  console.log('Conversation doc sample:', JSON.stringify({ id: convoDoc && convoDoc.id, participants: convoDoc && convoDoc.participants && convoDoc.participants.slice(0, 10) }));

  const sockets = [];
  const metrics = { sent: 0, delivered: 0, failed: 0, latencies: [] };
  const samples = [];

  for (let i = 0; i < NUM_CLIENTS; i++) {
    const userId = START_USER_ID + i;
    const token = tokenFor(userId);
    const socket = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });

    socket.on('connect', () => {
      // join conversation room
      socket.emit('join_conversation', conversationId);
    });

    socket.on('connect_error', (err) => {
      console.error(`socket connect_error user=${userId}`, err && err.message);
    });

    sockets.push({ socket, userId });

    // stagger connections slightly
    await sleep(CONNECTION_BATCH_DELAY_MS);
  }

  // wait a moment for all to join
  await sleep(1000);

  console.log('Starting message send phase...');

  for (const s of sockets) {
    (async () => {
      const { socket, userId } = s;
      for (let m = 0; m < MESSAGES_PER_CLIENT; m++) {
        const payload = { conversationId, content: `msg from ${userId} #${m}`, clientMessageId: `c_${userId}_${m}` };
        const start = Date.now();
        try {
          await new Promise((resolve) => {
            socket.emit('send_message', payload, (ack) => {
              metrics.sent++;
              const latency = Date.now() - start;
              metrics.latencies.push(latency);
              if (ack && ack.status === 'delivered') {
                metrics.delivered++;
              } else {
                metrics.failed++;
              }
              if (samples.length < 20) samples.push({ userId, payload, ack });
              resolve();
            });
          });
        } catch (err) {
          metrics.failed++;
        }
        await sleep(MESSAGE_INTERVAL_MS);
      }
    })();
  }

  // wait for all messages to be sent
  const estimatedMs = NUM_CLIENTS * MESSAGES_PER_CLIENT * MESSAGE_INTERVAL_MS / 4 + 5000;
  await sleep(Math.min(60000, estimatedMs));

  // collect metrics
  const avgLatency = metrics.latencies.length ? Math.round(metrics.latencies.reduce((a, b) => a + b, 0) / metrics.latencies.length) : 0;

  console.log('Load test complete');
  console.log('Clients:', NUM_CLIENTS);
  console.log('Messages per client:', MESSAGES_PER_CLIENT);
  console.log('Total sent:', metrics.sent);
  console.log('Delivered acks:', metrics.delivered);
  console.log('Failed:', metrics.failed);
  console.log('Avg ack latency(ms):', avgLatency);

  console.log('Sample acks:');
  for (const s of samples) {
    console.log(JSON.stringify({ userId: s.userId, clientMessageId: s.payload.clientMessageId, ack: s.ack }));
  }

  // teardown
  for (const s of sockets) {
    try { s.socket.disconnect(); } catch (e) { }
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('Load test error', err && err.stack ? err.stack : err);
  process.exit(2);
});
