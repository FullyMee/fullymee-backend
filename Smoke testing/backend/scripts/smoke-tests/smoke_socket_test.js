const { io } = require('socket.io-client');

const token = process.env.SOCKET_TOKEN;
if (!token) {
  console.error('Provide SOCKET_TOKEN env var');
  process.exit(1);
}

const socket = io('http://localhost:5001', {
  auth: { token },
  transports: ['websocket'],
  reconnection: false
});

socket.on('connect', () => {
  console.log('connected', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('connect_error', err && err.message);
  process.exit(2);
});

socket.on('presence_snapshot', (payload) => {
  console.log('presence_snapshot', payload);
  socket.disconnect();
});

socket.on('presence_update', (payload) => {
  console.log('presence_update', payload);
});

// Timeout guard
setTimeout(() => {
  console.error('timeout waiting for presence_snapshot');
  socket.disconnect();
  process.exit(3);
}, 8000);
