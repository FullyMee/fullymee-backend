const crypto = require('crypto');
const { sendOTPEmail } = require('../utils/email.notification');

exports.testEmail = async (req, res) => {
    try {
        if (process.env.ENABLE_EMAIL_DEBUG !== 'true') {
            return res.status(403).json({ error: 'Email debug endpoint is disabled' });
        }

        const { email, otp } = req.body || {};

        if (!email) {
            return res.status(400).json({ error: 'email is required' });
        }

        const testOtp = otp || crypto.randomInt(100000, 1000000).toString();
        const result = await sendOTPEmail(email, testOtp);

        return res.status(200).json({
            message: 'Test email request processed',
            email,
            otp: testOtp,
            result
        });
    } catch (err) {
        console.error('Test email error:', err);
        return res.status(500).json({
            error: 'Failed to send test email',
            details: err.message
        });
    }
};
