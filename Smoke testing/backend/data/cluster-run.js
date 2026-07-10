const cluster = require('cluster');
const os = require('os');
const net = require('net');
const path = require('path');

const numWorkers = Number(process.env.WORKERS || os.cpus().length);
const PORT = Number(process.env.PORT || 5010);

if (cluster.isMaster) {
  console.log(`Master listening on port ${PORT} - spawning ${numWorkers} workers`);

  // spawn workers
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({ CLUSTER_WORKER: 'true' });
  }

  function workerIndex(ip, len) {
    let s = 0;
    for (let i = 0; i < ip.length; i++) {
      s = ((s << 5) - s) + ip.charCodeAt(i);
      s |= 0;
    }
    return Math.abs(s) % len;
  }

  const server = net.createServer({ pauseOnConnect: true }, (connection) => {
    const workers = Object.values(cluster.workers);
    if (!workers.length) {
      connection.destroy();
      return;
    }
    const remoteIP = connection.remoteAddress || '';
    const idx = workerIndex(remoteIP, workers.length);
    const worker = workers[idx];
    if (!worker) {
      connection.destroy();
      return;
    }
    worker.send('sticky:connection', connection);
  });

  server.listen(PORT, () => console.log(`Master TCP server listening on ${PORT}`));

  cluster.on('exit', (worker, code, signal) => {
    console.error(`Worker ${worker.process.pid} died. Spawning a new one.`);
    cluster.fork({ CLUSTER_WORKER: 'true' });
  });
} else {
  // Worker - require the server which will set up handlers but not call .listen when CLUSTER_WORKER is true
  require(path.join(__dirname, 'src', 'server.js'));

  process.on('message', (msg, socket) => {
    if (msg === 'sticky:connection' && socket) {
      // Emulate a connection event on the server
      socket.resume();
      try {
        // server is created in server.js as `server` variable in module scope
        // emit connection directly
        process.nextTick(() => {
          // `server` is in module scope, accessible via require cache
          const srv = require(path.join(__dirname, 'src', 'server.js')).server;
          if (srv && typeof srv.emit === 'function') srv.emit('connection', socket);
        });
      } catch (e) {
        console.error('Worker failed to forward connection:', e && e.message ? e.message : e);
        try { socket.destroy(); } catch (err) {}
      }
    }
  });
}
