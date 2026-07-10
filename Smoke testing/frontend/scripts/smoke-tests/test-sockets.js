const path = require('path');
let mysql;
try {
  mysql = require('mysql2/promise');
} catch (e) {
  // Fallback to backend node_modules when running from project root
  mysql = require(path.join(__dirname, '..', 'backend', 'node_modules', 'mysql2', 'promise'));
}

let ioPkg;
try {
  ioPkg = require('socket.io-client');
} catch (e) {
  ioPkg = require(path.join(__dirname, '..', 'backend', 'node_modules', 'socket.io-client'));
}

const io = ioPkg.io || ioPkg.default || ioPkg;

let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  jwt = require(path.join(__dirname, '..', 'backend', 'node_modules', 'jsonwebtoken'));
}

let dotenv;
try {
  dotenv = require('dotenv');
} catch (e) {
  dotenv = require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'));
}

dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

(async () => {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 5
  });

  try {
    // Create three users
    const phones = ['+10000000001', '+10000000002', '+10000000003'];
    const userIds = [];

    for (const phone of phones) {
      const [rows] = await pool.query('SELECT id FROM users WHERE phone = ?', [phone]);
      if (rows.length) {
        userIds.push(rows[0].id);
      } else {
        const [res] = await pool.query('INSERT INTO users (phone) VALUES (?)', [phone]);
        userIds.push(res.insertId);
      }
    }

    console.log('Users:', userIds);

    // Create DM between user1 and user2
    const userA = userIds[0];
    const userB = userIds[1];

    const [existing] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants p1 ON c.id = p1.conversation_id
       JOIN conversation_participants p2 ON c.id = p2.conversation_id
       WHERE c.type='dm' AND p1.user_id=? AND p2.user_id=?`,
      [userA, userB]
    );

    let conversationId;
    if (existing.length) {
      conversationId = existing[0].id;
    } else {
      const [r] = await pool.query("INSERT INTO conversations (type) VALUES ('dm')");
      conversationId = r.insertId;
      await pool.query(
        'INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)',
        [conversationId, userA, conversationId, userB]
      );
    }

    console.log('Conversation ID:', conversationId);

    // Helper to create JWT
    function makeToken(userId, phone) {
      return jwt.sign({ userId, phone }, process.env.JWT_SECRET, { expiresIn: '7d' });
    }

    const tokens = userIds.map((id, i) => makeToken(id, phones[i]));

    // Connect three socket clients
    const clients = tokens.map(t => io(process.env.VITE_SOCKET_URL || 'http://localhost:5000', { auth: { token: t }, reconnection: false }));

    // Setup listeners
    clients.forEach((client, idx) => {
      client.on('connect', () => console.log(`Client ${idx+1} connected, socket id ${client.id}`));
      client.on('receive_message', (msg) => console.log(`Client ${idx+1} received message:`, msg));
      client.on('connect_error', (err) => console.error(`Client ${idx+1} connect_error:`, err.message));
    });

    // Wait for connections
    await new Promise(r => setTimeout(r, 1500));

    // Have user1 and user2 join the conversation
    clients[0].emit('join_conversation', conversationId);
    clients[1].emit('join_conversation', conversationId);

    // clients[2] does not join

    await new Promise(r => setTimeout(r, 500));

    // User1 sends a message
    const payload = {
      clientMessageId: 'test-' + Date.now(),
      conversationId,
      content: 'Hello from user1'
    };

    console.log('User1 sending message to conversation', conversationId);
    clients[0].emit('send_message', payload, (ack) => console.log('ACK from server:', ack));

    // Wait to receive
    await new Promise(r => setTimeout(r, 2000));

    // Clean up
    clients.forEach(c => c.disconnect());
    await pool.end();

    console.log('Test finished');
    process.exit(0);

  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
})();
