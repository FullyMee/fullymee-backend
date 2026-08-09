const nodemailer = require('nodemailer');

let transporter = null;
let smtpConfig = null;

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Missing required env: ${name}`);
    }
    return String(value).trim();
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeKey(rawKey) {
    if (!rawKey) return '';
    return String(rawKey).replace(/\r/g, '').replace(/\\n/g, '\n').trim();
}

function getDkimConfig() {
    const domain = String(process.env.SMTP_DKIM_DOMAIN || '').trim();
    const selector = String(process.env.SMTP_DKIM_SELECTOR || '').trim();
    const privateKey = normalizeKey(process.env.SMTP_DKIM_PRIVATE_KEY || '');
    if (!domain || !selector || !privateKey) {
        return null;
    }
    return { domain, selector, privateKey };
}

function isTransientEmailError(err) {
    if (!err) return false;
    const transientCodes = new Set(['ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ECONNREFUSED', 'ENOTFOUND', 'ESOCKET', 'EPIPE']);
    if (err.code && transientCodes.has(String(err.code))) return true;
    const transientResponseCodes = [421, 450, 451, 452, 454];
    if (Number.isFinite(err.responseCode) && transientResponseCodes.includes(Number(err.responseCode))) {
        return true;
    }
    return false;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTransporter() {
    if (transporter) return transporter;

    const host = getRequiredEnv('SMTP_HOST');
    const port = Number(process.env.SMTP_PORT || 587);
    const user = getRequiredEnv('SMTP_USER');
    const rawPass = getRequiredEnv('SMTP_PASS');

    // Remove accidental spaces (very common copy-paste issue)
    const pass = rawPass.replace(/\s+/g, '');

    // ⭐ Auto-detect secure flag: port 465 requires secure=true, port 587 requires secure=false (unless explicitly overridden)
    let secure;
    if (process.env.SMTP_SECURE !== undefined && String(process.env.SMTP_SECURE).trim() !== '') {
        secure = String(process.env.SMTP_SECURE).toLowerCase() === 'true';
    } else {
        secure = port === 465;
    }

    const dkim = getDkimConfig();
    smtpConfig = { host, port, secure, user, dkim: Boolean(dkim) };

    const transportOptions = {
        host,
        port,
        secure,
        auth: { user, pass },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
        tls: {
            rejectUnauthorized: false
        }
    };

    if (dkim) {
        transportOptions.dkim = dkim;
    }

    transporter = nodemailer.createTransport(transportOptions);
    return transporter;
}

function getSmtpConfig() {
    if (!smtpConfig) {
        getTransporter();
    }
    return smtpConfig;
}

async function sendMailWithRetry(mail) {
    const maxAttempts = parsePositiveInt(process.env.EMAIL_SEND_MAX_ATTEMPTS || 3, 3);
    const baseDelayMs = parsePositiveInt(process.env.EMAIL_SEND_RETRY_BASE_MS || 500, 500);

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const tx = getTransporter();
            const info = await tx.sendMail(mail);

            if (Array.isArray(info.accepted) && info.accepted.length > 0) {
                return info;
            }

            if (Array.isArray(info.rejected) && info.rejected.length > 0) {
                const err = new Error(`Email rejected by SMTP provider: ${info.rejected.join(', ')}`);
                err.responseCode = info.responseCode || 0;
                throw err;
            }

            return info;
        } catch (err) {
            transporter = null; // Reset transporter on failure to force fresh connection on retry
            lastError = err;
            if (attempt >= maxAttempts || !isTransientEmailError(err)) {
                throw err;
            }

            const backoff = Math.min(10000, baseDelayMs * 2 ** (attempt - 1));
            const jitter = Math.round(backoff * (0.8 + Math.random() * 0.4));
            await sleep(jitter);
        }
    }

    throw lastError || new Error('Failed to send email after retries');
}

function buildOtpEmailHtml({ otp, expiresMin }) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
            <h2 style="margin-bottom: 8px;">Your verification code</h2>
            <p style="margin-top: 0;">Use the OTP below to sign in.</p>
            <div style="font-size: 28px; font-weight: 700; letter-spacing: 4px; margin: 24px 0;">
                ${otp}
            </div>
            <p style="margin-bottom: 0;">This OTP expires in ${expiresMin} minutes.</p>
        </div>
    `;
}

async function sendOTPEmail(email, otp) {
    const sender = process.env.SMTP_FROM || getRequiredEnv('SMTP_USER');
    const senderName = String(process.env.SMTP_FROM_NAME || '').trim();
    const from = senderName ? `${senderName} <${sender}>` : sender;
    const expiresMin = Number(process.env.OTP_EXPIRES_MIN || 5);
    const subject = process.env.OTP_EMAIL_SUBJECT || 'Your login verification code';

    const mail = {
        from,
        to: email,
        subject,
        text: `Your verification code is ${otp}. It expires in ${expiresMin} minutes.`,
        html: buildOtpEmailHtml({ otp, expiresMin })
    };

    try {
        const info = await sendMailWithRetry(mail);
        return {
            provider: 'smtp',
            accepted: info.accepted,
            rejected: info.rejected,
            messageId: info.messageId,
            response: info.response
        };
    } catch (err) {
        console.error('Email OTP delivery failed:', err && err.message ? err.message : err);
        throw new Error('Failed to send OTP email');
    }
}

async function verifySMTPConnection() {
    try {
        const tx = getTransporter();
        await tx.verify();
        return { provider: 'smtp', ...getSmtpConfig() };
    } catch (err) {
        console.error('Email provider verification failed:', err.message);
        throw err;
    }
}

module.exports = { sendOTPEmail, verifySMTPConnection, getSmtpConfig };
