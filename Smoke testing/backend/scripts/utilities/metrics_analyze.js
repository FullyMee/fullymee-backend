const fs = require('fs');
const path = require('path');

function readCSV(file) {
  if (!fs.existsSync(file)) return [];
  const data = fs.readFileSync(file, 'utf8').trim().split('\n');
  return data.slice(1).map((r) => r.split(',').map((c) => c.trim()));
}

function percentiles(arr, p) {
  if (!arr.length) return null;
  arr.sort((a,b)=>a-b);
  const idx = (p/100) * (arr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  return arr[lo] + (arr[hi]-arr[lo])*(idx-lo);
}

const persistFile = path.join(__dirname, '..', 'metrics', 'persist_latency.csv');
const resourceFile = path.join(__dirname, '..', 'metrics', 'resource_log.csv');

const persistRows = readCSV(persistFile).map(r => ({ ts: Number(r[0]), id: Number(r[1]), latency: Number(r[2]) })).filter(r=>r.latency>=0);
const latencies = persistRows.map(r=>r.latency);

const report = {};
report.count = latencies.length;
if (latencies.length) {
  report.avg = latencies.reduce((a,b)=>a+b,0)/latencies.length;
  report.min = Math.min(...latencies);
  report.max = Math.max(...latencies);
  report.p50 = percentiles(latencies,50);
  report.p95 = percentiles(latencies,95);
  report.p99 = percentiles(latencies,99);
}

const resRows = readCSV(resourceFile).map(r=>({ ts: Number(r[0]), rss: Number(r[1]), heapUsed: Number(r[2]), heapTotal: Number(r[3]), external: Number(r[4]), cpuUser: Number(r[5]), cpuSystem: Number(r[6]), cpus: Number(r[7]) }));
if (resRows.length) {
  report.resource = {
    samples: resRows.length,
    avgRss: resRows.reduce((a,b)=>a+b.rss,0)/resRows.length,
    maxRss: Math.max(...resRows.map(r=>r.rss)),
    avgHeapUsed: resRows.reduce((a,b)=>a+b.heapUsed,0)/resRows.length,
    maxHeapUsed: Math.max(...resRows.map(r=>r.heapUsed)),
    avgCpuUser: resRows.reduce((a,b)=>a+b.cpuUser,0)/resRows.length,
    avgCpuSystem: resRows.reduce((a,b)=>a+b.cpuSystem,0)/resRows.length
  }
}

console.log(JSON.stringify(report,null,2));
