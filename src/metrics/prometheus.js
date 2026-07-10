const client = require('prom-client');

const register = new client.Registry();

client.collectDefaultMetrics({ register });

const enqueueCounter = new client.Counter({
    name: 'messages_enqueued_total',
    help: 'Total messages enqueued for persistence'
});

const persistedCounter = new client.Counter({
    name: 'messages_persisted_total',
    help: 'Total messages persisted to DB'
});

const persistLatency = new client.Histogram({
    name: 'message_persist_latency_ms',
    help: 'Histogram of message persist latencies in ms',
    buckets: [5, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000]
});

const queueLengthGauge = new client.Gauge({
    name: 'persist_queue_length',
    help: 'Current length of in-memory persist queue'
});

const reconcileFailures = new client.Counter({
    name: 'reconcile_failures_total',
    help: 'Number of reconciliation failures'
});
 
const apiRateLimit429 = new client.Counter({
    name: 'api_rate_limit_429_total',
    help: 'Total number of API rate limit rejections',
    labelNames: ['type', 'method', 'endpoint']
});
 
const authOtpRequestTotal = new client.Counter({
    name: 'auth_otp_request_total',
    help: 'Total number of OTP request attempts'
});

const authOtpSendFailureTotal = new client.Counter({
    name: 'auth_otp_send_failure_total',
    help: 'Total number of OTP email send failures'
});

const authOtpFailedTotal = new client.Counter({
    name: 'auth_otp_failed_total',
    help: 'Total number of failed OTP verification attempts'
});

const authOtpLockedTotal = new client.Counter({
    name: 'auth_otp_locked_total',
    help: 'Total number of OTP lockouts due to repeated failures'
});

const authLoginSuccessTotal = new client.Counter({
    name: 'auth_login_success_total',
    help: 'Total number of successful auth logins via OTP or Google signin'
});

const authGoogleSigninFailureTotal = new client.Counter({
    name: 'auth_google_signin_failure_total',
    help: 'Total number of failed Google sign-ins'
});

const authRefreshSuccessTotal = new client.Counter({
    name: 'auth_refresh_success_total',
    help: 'Total successful auth refresh token exchanges'
});

const authRefreshFailureTotal = new client.Counter({
    name: 'auth_refresh_failure_total',
    help: 'Total failed auth refresh attempts'
});

const authTokenRevokedTotal = new client.Counter({
    name: 'auth_token_revoked_total',
    help: 'Total number of refresh tokens revoked for logout or rotation'
});

const authTokenVersionMismatchTotal = new client.Counter({
    name: 'auth_token_version_mismatch_total',
    help: 'Total number of auth attempts rejected because the token version was revoked'
});
 
const workerUp = new client.Gauge({
    name: 'persist_worker_up',
    help: '1 if persistence worker is running, 0 otherwise'
});

register.registerMetric(enqueueCounter);
register.registerMetric(persistedCounter);
register.registerMetric(persistLatency);
register.registerMetric(queueLengthGauge);
register.registerMetric(reconcileFailures);
register.registerMetric(apiRateLimit429);
register.registerMetric(authOtpRequestTotal);
register.registerMetric(authOtpSendFailureTotal);
register.registerMetric(authOtpFailedTotal);
register.registerMetric(authOtpLockedTotal);
register.registerMetric(authLoginSuccessTotal);
register.registerMetric(authGoogleSigninFailureTotal);
register.registerMetric(authRefreshSuccessTotal);
register.registerMetric(authRefreshFailureTotal);
register.registerMetric(authTokenRevokedTotal);
register.registerMetric(authTokenVersionMismatchTotal);
register.registerMetric(workerUp);

function recordEnqueue() {
    enqueueCounter.inc();
}

function recordPersist(latencyMs) {
    persistedCounter.inc();
    if (typeof latencyMs === 'number' && latencyMs >= 0) persistLatency.observe(latencyMs);
}

function setQueueLength(n) {
    queueLengthGauge.set(typeof n === 'number' ? n : 0);
}

function recordReconcileFailure() {
    reconcileFailures.inc();
}
 
function recordApiRateLimit({ type = 'unknown', method = 'UNKNOWN', endpoint = 'unknown' } = {}) {
    try {
        apiRateLimit429.labels(type, method, endpoint).inc();
    } catch (e) {
        // Ignore metric label failures in production.
    }
}
 
function recordAuthOtpRequest() {
    authOtpRequestTotal.inc();
}

function recordAuthOtpSendFailure() {
    authOtpSendFailureTotal.inc();
}

function recordAuthOtpFailed() {
    authOtpFailedTotal.inc();
}

function recordAuthOtpLocked() {
    authOtpLockedTotal.inc();
}

function recordAuthLoginSuccess() {
    authLoginSuccessTotal.inc();
}

function recordAuthGoogleSigninFailure() {
    authGoogleSigninFailureTotal.inc();
}

function recordAuthRefreshSuccess() {
    authRefreshSuccessTotal.inc();
}

function recordAuthRefreshFailure() {
    authRefreshFailureTotal.inc();
}

function recordAuthTokenRevoked() {
    authTokenRevokedTotal.inc();
}

function recordAuthTokenVersionMismatch() {
    authTokenVersionMismatchTotal.inc();
}

function setWorkerUp(up) {
    workerUp.set(up ? 1 : 0);
}

async function metricsEndpoint(req, res) {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (e) {
        res.status(500).end(e && e.message ? e.message : String(e));
    }
}

module.exports = {
    register,
    recordEnqueue,
    recordPersist,
    setQueueLength,
    recordReconcileFailure,
    recordApiRateLimit,
    recordAuthOtpRequest,
    recordAuthOtpSendFailure,
    recordAuthOtpFailed,
    recordAuthOtpLocked,
    recordAuthLoginSuccess,
    recordAuthGoogleSigninFailure,
    recordAuthRefreshSuccess,
    recordAuthRefreshFailure,
    recordAuthTokenRevoked,
    recordAuthTokenVersionMismatch,
    setWorkerUp,
    metricsEndpoint
};
