const authService = require('../src/services/auth.service');
const { verifySMTPConnection, getSmtpConfig } = require('../src/utils/email.notification');
const metrics = require('../src/metrics/prometheus');

async function run() {
    console.log('Auth production readiness smoke test');

    try {
        const smtpConfig = getSmtpConfig();
        console.log('SMTP config loaded:', smtpConfig);
    } catch (err) {
        console.warn('SMTP config is not fully available:', err.message);
    }

    if (process.env.SMTP_HOST) {
        try {
            const verification = await verifySMTPConnection();
            console.log('SMTP provider verification succeeded:', verification);
        } catch (err) {
            console.error('SMTP provider verification failed:', err && err.message ? err.message : err);
            process.exit(1);
        }
    } else {
        console.log('SMTP_HOST is not configured; skipping SMTP verification. Ensure this is set in production.');
    }

    if (process.env.GOOGLE_CLIENT_ID) {
        try {
            await authService.loginWithGoogle('invalid-token');
            console.error('Expected invalid Google token to fail but it succeeded');
            process.exit(1);
        } catch (err) {
            console.log('Google ID token verification correctly rejected invalid token:', err.message);
        }
    } else {
        console.log('GOOGLE_CLIENT_ID is not configured; skipping Google ID token verification test.');
    }

    console.log('Recording sample auth metrics counters');
    try {
        metrics.recordAuthOtpRequest();
        metrics.recordAuthOtpFailed();
        metrics.recordAuthOtpSendFailure();
        metrics.recordAuthOtpLocked();
        metrics.recordAuthLoginSuccess();
        metrics.recordAuthGoogleSigninFailure();
        metrics.recordAuthRefreshSuccess();
        metrics.recordAuthRefreshFailure();
        metrics.recordAuthTokenRevoked();
        metrics.recordAuthTokenVersionMismatch();
        console.log('Auth metrics counters invoked successfully');
    } catch (err) {
        console.error('Failed to record auth metrics counters:', err && err.message ? err.message : err);
        process.exit(1);
    }

    console.log('Auth production readiness smoke test completed successfully');
}

run().catch((err) => {
    console.error('Auth production readiness smoke test failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
