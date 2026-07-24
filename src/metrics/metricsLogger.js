const fs = require('fs');
const os = require('os');
const path = require('path');

const METRICS_DIR = 'metrics';

function initMetricsFiles() {
    try {
        fs.mkdirSync(METRICS_DIR, { recursive: true });
    } catch (e) {}

    const persistLatencyCsv = path.join(METRICS_DIR, 'persist_latency.csv');
    const resourceLogCsv = path.join(METRICS_DIR, 'resource_log.csv');

    if (!fs.existsSync(persistLatencyCsv)) {
        fs.writeFileSync(persistLatencyCsv, 'timestamp,messageId,latencyMs\n');
    }
    if (!fs.existsSync(resourceLogCsv)) {
        fs.writeFileSync(resourceLogCsv, 'timestamp,rss,heapUsed,heapTotal,external,cpuUser,cpuSystem,cpus\n');
    }

    return { persistLatencyCsv, resourceLogCsv };
}

const { persistLatencyCsv, resourceLogCsv } = initMetricsFiles();

function logPersistLatency(now, id, latency) {
    try {
        fs.appendFile(persistLatencyCsv, `${now},${id},${latency}\n`, () => {});
    } catch (e) {}
}

function startResourceMonitoring(intervalMs = 5000) {
    let lastCpu = process.cpuUsage();
    let lastTime = Date.now();

    const timer = setInterval(() => {
        try {
            const mem = process.memoryUsage();
            const cpu = process.cpuUsage(lastCpu);
            const now = Date.now();
            const elapsedMs = now - lastTime;
            lastTime = now;
            lastCpu = process.cpuUsage();

            const cpuUserPct = Math.round((cpu.user / 1000) / (elapsedMs || 1) * 100) / 100;
            const cpuSysPct = Math.round((cpu.system / 1000) / (elapsedMs || 1) * 100) / 100;
            const cpus = os.cpus().length;

            const row = `${now},${mem.rss},${mem.heapUsed},${mem.heapTotal},${mem.external},${cpuUserPct},${cpuSysPct},${cpus}\n`;
            fs.appendFile(resourceLogCsv, row, () => {});
        } catch (e) {}
    }, intervalMs);

    return timer;
}

module.exports = {
    initMetricsFiles,
    logPersistLatency,
    startResourceMonitoring
};
