require('dotenv').config();
const { buildOtpEmailHtml, sendOTPEmail, verifyEmailConnection } = require('../src/utils/email.notification');

async function testEmailModule() {
    console.log('=== EMAIL NOTIFICATION MODULE DIAGNOSTIC ===');

    // 1. Check environment variables
    console.log('\n[1] Checking Environment Variables:');
    console.log('  RESEND_API_KEY :', process.env.RESEND_API_KEY ? `Configured (starts with ${process.env.RESEND_API_KEY.slice(0, 6)}...)` : 'NOT SET');
    console.log('  EMAIL_FROM     :', process.env.EMAIL_FROM || 'NOT SET');
    console.log('  SMTP_HOST      :', process.env.SMTP_HOST || 'NOT SET');
    console.log('  SMTP_PORT      :', process.env.SMTP_PORT || 'NOT SET');
    console.log('  SMTP_SECURE    :', process.env.SMTP_SECURE || 'NOT SET');
    console.log('  SMTP_USER      :', process.env.SMTP_USER || 'NOT SET');

    // 2. Test HTML template generation
    console.log('\n[2] Testing HTML Template Rendering:');
    const sampleHtml = buildOtpEmailHtml({ otp: '482190', expiresMin: 5 });
    if (sampleHtml.includes('FullyMee') && sampleHtml.includes('4&nbsp;&nbsp;8&nbsp;&nbsp;2&nbsp;&nbsp;1&nbsp;&nbsp;9&nbsp;&nbsp;0') && sampleHtml.includes('Verification Code')) {
        console.log('  ✓ HTML template renders FullyMee branding, formatted 6-digit OTP, and security styles.');
    } else {
        console.error('  ✗ HTML template missing required elements');
        process.exit(1);
    }

    // 3. Test Connection Status
    console.log('\n[3] Verifying Provider Status:');
    const connection = await verifyEmailConnection();
    console.log('  Provider Status:', JSON.stringify(connection, null, 2));

    // 4. Live Send Test (if target email passed via CLI argument)
    const targetEmail = process.argv[2];
    if (targetEmail && targetEmail.includes('@')) {
        console.log(`\n[4] Sending Live Test OTP to: ${targetEmail}...`);
        const startTime = Date.now();
        try {
            const testOtp = '729401';
            const result = await sendOTPEmail(targetEmail, testOtp);
            const duration = Date.now() - startTime;
            console.log(`  ✓ Test OTP sent successfully in ${duration}ms!`);
            console.log('  Result:', JSON.stringify(result, null, 2));
        } catch (err) {
            console.error(`  ✗ Delivery failed:`, err.message);
            if (err.resendError) {
                console.error('  Resend details:', err.resendError);
            }
            process.exit(1);
        }
    } else {
        console.log('\n[4] Live send skipped. To send a real test email, run:');
        console.log('    node scripts/test_email_notification.js your_email@example.com');
    }

    console.log('\n=== ALL DIAGNOSTIC CHECKS COMPLETED ===\n');
}

testEmailModule().catch((err) => {
    console.error('Diagnostic error:', err);
    process.exit(1);
});
