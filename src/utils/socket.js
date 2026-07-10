const { EventEmitter } = require('events');

// Simple socket helper to avoid using globals
const socketState = {
  io: null,
  onlineUsers: new Map(), // userId -> Set(socketId)
  emitter: new EventEmitter()
};

function setIO(ioInstance) {
  socketState.io = ioInstance;
}

function getIO() {
  return socketState.io;
}

function getOnlineUsers() {
  return socketState.onlineUsers;
}

module.exports = {
  setIO,
  getIO,
  getOnlineUsers,
  emitter: socketState.emitter
};
