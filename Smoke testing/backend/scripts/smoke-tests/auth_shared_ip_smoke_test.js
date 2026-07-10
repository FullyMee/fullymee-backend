const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { once } = require('events');
const { googleSigninLimiter, requestOtpLimiter } = require('../src/middleware/rateLimit.middleware');

function buildCredential(email) {
    return jwt.sign({ email }, 'smoke-test-secret', { algorithm: 'HS256', expiresIn: '1m' });
}

async function sendRequests(baseUrl, path, bodies, concurrency = 10) {
    const results = [];
    for (let i = 0; i < bodies.length; i += concurrency) {
        const chunk = bodies.slice(i, i + concurrency).map((body) => {
            return axios.post(`${baseUrl}${path}`, body, {
                validateStatus: () => true,
                timeout: 5000
            });
        });
        const responses = await Promise.all(chunk);
        results.push(...responses);
    }
    return results;
}

async function run() {
    console.log('Auth shared-IP smoke test');

    const app = express();
    app.use(express.json());

    app.post('/api/auth/google-signin', ...googleSigninLimiter, (req, res) => {
        return res.status(200).json({ success: true, email: req.body && req.body.credential ? jwt.decode(req.body.credential)?.email : null });
    });

    app.post('/api/auth/request-otp', ...requestOtpLimiter, (req, res) => {
        return res.status(200).json({ success: true, email: req.body.email });
    });

    const server = app.listen(0);
    await once(server, 'listening');
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        console.log('Testing 40 simultaneous Google signin attempts from the same shared IP');
        const googleBodies = Array.from({ length: 40 }, (_, index) => ({
            credential: buildCredential(`campus-user-${index + 1}@example.edu`)
        }));
        const googleResponses = await sendRequests(baseUrl, '/api/auth/google-signin', googleBodies, 20);
        const googleErrors = googleResponses.filter((response) => response.status !== 200);
        if (googleErrors.length > 0) {
            console.error('One or more Google signin requests failed unexpectedly:', googleErrors.map((response) => ({ status: response.status, data: response.data })).slice(0, 5));
            process.exit(1);
        }
        console.log('All 40 Google signin requests succeeded under the shared-IP limiter.');

        console.log('Testing 40 unique OTP requests from the same shared IP');
        const otpBodies = Array.from({ length: 40 }, (_, index) => ({
            email: `campus-otp-${index + 1}@example.edu`
        }));
        const otpResponses = await sendRequests(baseUrl, '/api/auth/request-otp', otpBodies, 20);
        const otpErrors = otpResponses.filter((response) => response.status !== 200);
        if (otpErrors.length > 0) {
            console.error('One or more OTP request attempts failed unexpectedly:', otpErrors.map((response) => ({ status: response.status, data: response.data })).slice(0, 5));
            process.exit(1);
        }
        console.log('All 40 unique OTP requests succeeded under the shared-IP limiter.');

        console.log('Validating per-email limits for OTP requests');
        const sameEmailBodies = Array.from({ length: 6 }, () => ({ email: 'repeat-user@example.edu' }));
        const sameEmailResponses = await sendRequests(baseUrl, '/api/auth/request-otp', sameEmailBodies, 6);
        const tooMany = sameEmailResponses.filter((response) => response.status === 429);
        if (tooMany.length !== 1) {
            console.error('Per-email limit did not behave as expected for OTP requests:', sameEmailResponses.map((response) => ({ status: response.status, data: response.data })));
            process.exit(1);
        }
        console.log('Per-email OTP request limit is active and correctly blocked the sixth request.');

        console.log('Auth shared-IP smoke test completed successfully');
    } finally {
        server.close();
    }
}

run().catch((err) => {
    console.error('Auth shared-IP smoke test failed:', err && err.stack ? err.stack : err);
    process.exit(1);
});
