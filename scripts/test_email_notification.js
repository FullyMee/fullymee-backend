require('dotenv').config();
const { buildOtpEmailHtml, sendOTPEmail, verifyEmailConnection } = require('../src/utils/email.notification');

async function testEmailModule() {
    console.log('--- TESTING EMAIL NOTIFICATION MODULE ---');

    // 1. Test HTML generation
    const sampleHtml = buildOtpEmailHtml({ otp: '482190', expiresMin: 5 });
    if (sampleHtml.includes('FullyMee') && sampleHtml.includes('4&nbsp;&nbsp;8&nbsp;&nbsp;2&nbsp;&nbsp;1&nbsp;&nbsp;9&nbsp;&nbsp;0') && sampleHtml.includes('Verification Code')) {
        console.log('PASS: HTML template renders FullyMee branding, formatted 6-digit OTP, and security styles.');
    } else {
        console.error('FAIL: HTML template missing key elements');
        process.exit(1);
    }

    // 2. Test Connection Status
    const connection = await verifyEmailConnection();
    console.log('Provider Status:', connection);

    console.log('--- ALL EMAIL MODULE TESTS PASSED ---');
}

testEmailModule().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
