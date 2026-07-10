const path = require('path');
const dotenv = require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

const mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
const jwt = require(path.join(__dirname, '..', 'backend', 'node_modules', 'jsonwebtoken'));

const API_BASE = process.env.VITE_API_URL || 'http://localhost:5000/api';

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5
  });

  try {
    // Ensure two users exist
    const phones = ['+10000000001', '+10000000002'];
    const userIds = [];
    for (const phone of phones) {
      const [rows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (rows.length) userIds.push(rows[0].id);
      else {
        const [r] = await pool.query('INSERT INTO users (phone) VALUES (?)', [phone]);
        userIds.push(r.insertId);
      }
    }

    console.log('Test users:', phones, 'IDs:', userIds);

    const tokens = userIds.map((id, idx) => jwt.sign({ userId: id, phone: phones[idx] }, process.env.JWT_SECRET, { expiresIn: '7d' }));

    // helper for fetch with node
    const fetch = global.fetch || (await import('node-fetch')).default;

    // 1) GET /api/users with token for user1
    console.log('\n1) GET /api/users (authenticated):');
    let res = await fetch(`${API_BASE}/users`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());

    // 2) GET /api/users without token
    console.log('\n2) GET /api/users (unauthenticated):');
    res = await fetch(`${API_BASE}/users`);
    console.log('Status:', res.status);
    console.log('Body:', await res.text());

    // 3) POST /api/conversations/create-dm (create DM between user1 and user2)
    console.log('\n3) POST /api/conversations/create-dm:');
    res = await fetch(`${API_BASE}/conversations/create-dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[0]}` },
      body: JSON.stringify({ targetUserId: userIds[1] })
    });
    console.log('Status:', res.status);
    const createBody = await res.text();
    console.log('Body:', createBody);

    let convId = null;
    try { convId = JSON.parse(createBody).conversationId; } catch (e) {}

    // 4) GET /api/conversations (user1)
    console.log('\n4) GET /api/conversations (authenticated):');
    res = await fetch(`${API_BASE}/conversations`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());

    // 5) GET /api/messages/:convId (if convId)
    if (convId) {
      console.log(`\n5) GET /api/messages/${convId}:`);
      res = await fetch(`${API_BASE}/messages/${convId}`, { headers: { Authorization: `Bearer ${tokens[0]}` } });
      console.log('Status:', res.status);
      console.log('Body:', await res.text());
    } else {
      console.log('\n5) Skipped messages fetch because conversationId not returned');
    }

    // 6) Negative test: POST create-dm without body
    console.log('\n6) POST /api/conversations/create-dm (missing targetUserId):');
    res = await fetch(`${API_BASE}/conversations/create-dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[0]}` },
      body: JSON.stringify({})
    });
    console.log('Status:', res.status);
    console.log('Body:', await res.text());

    await pool.end();

    console.log('\nAPI tests complete');
    process.exit(0);
  } catch (err) {
    console.error('API test error:', err);
    process.exit(1);
  }
}

run();
