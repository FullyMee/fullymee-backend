const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

/* ─── Singleton Caches ─────────────────────────────────────────────── */
let resendClient = null;
let transporter = null;
let smtpConfig = null;

/* ─── Helpers ──────────────────────────────────────────────────────── */
function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Basic email format guard – prevents obviously invalid addresses from
 * reaching the provider and burning API quota.
 */
function isValidEmailAddress(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/**
 * Classify an error as transient (worth retrying) or permanent.
 * Resend HTTP errors include a `statusCode` on the error object.
 */
function isTransientError(err) {
    if (!err) return false;

    // Resend rate-limit (429) or server errors (5xx)
    const status = err.statusCode || err.status || (err.resendError && err.resendError.statusCode) || 0;
    if (status === 429 || (status >= 500 && status < 600)) return true;

    // Network / timeout errors
    const msg = String(err.message || err.code || '').toLowerCase();
    if (/timeout|econnreset|econnrefused|enotfound|socket hang up|network|epipe/i.test(msg)) return true;

    return false;
}

/**
 * Generate a deterministic idempotency key for a Resend API call so
 * retries of the same OTP delivery don't produce duplicate sends.
 */
function makeIdempotencyKey(to, subject, text) {
    return crypto
        .createHash('sha256')
        .update(`${to}|${subject}|${text}|${Math.floor(Date.now() / 30000)}`)
        .digest('hex')
        .slice(0, 48);
}

/* ─── Provider Factories ───────────────────────────────────────────── */
function getResendClient() {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    if (!apiKey) return null;
    if (!resendClient) {
        resendClient = new Resend(apiKey);
    }
    return resendClient;
}

function getSender() {
    return String(
        process.env.EMAIL_FROM ||
        process.env.RESEND_FROM ||
        process.env.SMTP_FROM ||
        'FullyMee <hello@fullymee.in>'
    ).trim();
}

function getRequiredEnv(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Missing required env: ${name}`);
    }
    return String(value).trim();
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

function getTransporter() {
    if (transporter) return transporter;

    const host = getRequiredEnv('SMTP_HOST');
    const port = Number(process.env.SMTP_PORT || 465);
    const user = getRequiredEnv('SMTP_USER');
    const rawPass = getRequiredEnv('SMTP_PASS');
    const pass = rawPass.replace(/\s+/g, '');

    let secure;
    if (process.env.SMTP_SECURE !== undefined && String(process.env.SMTP_SECURE).trim() !== '') {
        secure = String(process.env.SMTP_SECURE).toLowerCase() === 'true';
    } else {
        secure = port === 465;
    }

    const dkim = getDkimConfig();
    smtpConfig = { host, port, secure, user, dkim: Boolean(dkim) };

    const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

    const transportOptions = {
        host,
        port,
        secure,
        auth: { user, pass },
        pool: true,                     // Enable connection pooling for throughput
        maxConnections: 5,
        maxMessages: 100,
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 15000,
        tls: {
            // Enforce TLS certificate validation in production
            rejectUnauthorized: isProduction
        }
    };

    if (dkim) {
        transportOptions.dkim = dkim;
    }

    transporter = nodemailer.createTransport(transportOptions);
    return transporter;
}

function getSmtpConfig() {
    if (!smtpConfig && process.env.SMTP_HOST) {
        try {
            getTransporter();
        } catch (_) {}
    }
    return smtpConfig;
}

/* ─── Email HTML Template ──────────────────────────────────────────── */
function buildOtpEmailHtml({ otp, expiresMin }) {
    const otpSpaced = String(otp || '').split('').join('&nbsp;&nbsp;');
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your FullyMee Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #faf5ff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2d124d;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #faf5ff; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" max-width="480" cellspacing="0" cellpadding="0" border="0" style="max-width: 480px; background-color: #ffffff; border-radius: 24px; box-shadow: 0 12px 40px rgba(124, 58, 237, 0.08); border: 1px solid #f3e8ff; overflow: hidden;">
          
          <!-- Header Banner -->
          <tr>
            <td align="center" style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 50%, #ec4899 100%); padding: 32px 24px 28px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">
                FullyMee <span style="font-size: 20px;">✦</span>
              </h1>
              <p style="margin: 6px 0 0; color: rgba(255, 255, 255, 0.9); font-size: 13px; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase;">
                A safe space to be you
              </p>
            </td>
          </tr>

          <!-- Main Content Body -->
          <tr>
            <td style="padding: 36px 32px 28px; text-align: center;">
              <h2 style="margin: 0 0 10px; font-size: 20px; font-weight: 700; color: #2d124d;">
                Your Verification Code
              </h2>
              <p style="margin: 0 0 24px; font-size: 14px; line-height: 1.5; color: #6b7280;">
                Enter this one-time code to securely sign in to your anonymous space.
              </p>

              <!-- 6-Digit OTP Box -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; background-color: #faf5ff; border: 2px dashed #c084fc; border-radius: 16px; padding: 16px 28px;">
                      <span style="font-family: 'Courier New', Courier, monospace, sans-serif; font-size: 34px; font-weight: 800; letter-spacing: 6px; color: #7c3aed; line-height: 1;">
                        ${otpSpaced}
                      </span>
                    </div>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #7c3aed;">
                ⏱️ Valid for ${expiresMin} minutes only
              </p>

              <div style="background-color: #fdf4ff; border-radius: 12px; padding: 12px 16px; margin-top: 20px; text-align: left; border: 1px solid #fae8ff;">
                <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #86198f;">
                  🔒 <strong>Privacy & Security:</strong> Never share this code with anyone. FullyMee will never ask for your verification code.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #fbfbfe; padding: 20px 32px; border-top: 1px solid #f3e8ff; text-align: center;">
              <p style="margin: 0 0 4px; font-size: 12px; color: #9ca3af;">
                If you didn't request this email, you can safely ignore it.
              </p>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1;">
                FullyMee · Anonymous & Safe Platform
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
}

/* ─── Resend API Send (Primary) ────────────────────────────────────── */
async function sendMailViaResend(resend, { from, to, subject, text, html }) {
    const maxAttempts = parsePositiveInt(process.env.EMAIL_SEND_MAX_ATTEMPTS || 3, 3);
    const baseDelayMs = parsePositiveInt(process.env.EMAIL_SEND_RETRY_BASE_MS || 500, 500);
    const idempotencyKey = makeIdempotencyKey(to, subject, text);

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const { data, error } = await resend.emails.send({
                from,
                to,
                subject,
                text,
                html,
                headers: {
                    'X-Idempotency-Key': idempotencyKey
                }
            });

            if (error) {
                const err = new Error(error.message || 'Resend email delivery error');
                err.resendError = error;
                err.statusCode = error.statusCode || 0;
                throw err;
            }

            return {
                provider: 'resend',
                messageId: data && data.id ? data.id : null,
                accepted: [to]
            };
        } catch (err) {
            lastError = err;

            // Don't retry permanent errors (validation, auth, bad request)
            if (!isTransientError(err)) {
                throw err;
            }

            if (attempt >= maxAttempts) {
                throw err;
            }

            // Rate-limit: use Retry-After if available, else exponential backoff
            let backoff;
            const retryAfter = err.resendError && err.resendError.retryAfter;
            if (retryAfter && Number(retryAfter) > 0) {
                backoff = Math.min(30000, Number(retryAfter) * 1000);
            } else {
                backoff = Math.min(6000, baseDelayMs * 2 ** (attempt - 1));
            }
            const jitter = Math.round(backoff * (0.8 + (crypto.randomInt(0, 1000) / 1000) * 0.4));
            await sleep(jitter);
        }
    }

    throw lastError || new Error('Failed to send email via Resend after retries');
}

/* ─── SMTP Send (Fallback) ─────────────────────────────────────────── */
async function sendMailViaSmtp(mail) {
    const maxAttempts = parsePositiveInt(process.env.EMAIL_SEND_MAX_ATTEMPTS || 3, 3);
    const baseDelayMs = parsePositiveInt(process.env.EMAIL_SEND_RETRY_BASE_MS || 500, 500);

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const tx = getTransporter();
            const info = await tx.sendMail(mail);

            if (Array.isArray(info.accepted) && info.accepted.length > 0) {
                return {
                    provider: 'smtp',
                    messageId: info.messageId,
                    accepted: info.accepted,
                    rejected: info.rejected || [],
                    response: info.response
                };
            }

            if (Array.isArray(info.rejected) && info.rejected.length > 0) {
                const err = new Error(`Email rejected by SMTP provider: ${info.rejected.join(', ')}`);
                err.responseCode = info.responseCode || 0;
                throw err;
            }

            return {
                provider: 'smtp',
                messageId: info.messageId,
                accepted: [mail.to]
            };
        } catch (err) {
            transporter = null; // Reset connection on failure
            lastError = err;
            if (attempt >= maxAttempts) {
                throw err;
            }

            const backoff = Math.min(10000, baseDelayMs * 2 ** (attempt - 1));
            const jitter = Math.round(backoff * (0.8 + (crypto.randomInt(0, 1000) / 1000) * 0.4));
            await sleep(jitter);
        }
    }

    throw lastError || new Error('Failed to send email via SMTP after retries');
}

/* ─── Public: Send OTP Email ───────────────────────────────────────── */
async function sendOTPEmail(email, otp) {
    // Validate recipient before hitting any provider
    if (!isValidEmailAddress(email)) {
        throw new Error('Invalid recipient email address');
    }

    const from = getSender();
    const expiresMin = Number(process.env.OTP_EXPIRES_MIN || 5);
    const subject = process.env.OTP_EMAIL_SUBJECT || 'Your FullyMee verification code';

    const mailData = {
        from,
        to: email,
        subject,
        text: `Your FullyMee verification code is ${otp}. It expires in ${expiresMin} minutes.`,
        html: buildOtpEmailHtml({ otp, expiresMin })
    };

    const resend = getResendClient();

    // 1. Primary: Use Resend API if API Key is configured
    if (resend) {
        try {
            const result = await sendMailViaResend(resend, mailData);
            console.log(`[Email] OTP sent to ${email} via Resend API (ID: ${result.messageId}) from ${from}`);
            return result;
        } catch (err) {
            console.error('[Email] Resend API delivery failed:', err && err.message ? err.message : err);
            // Fall back to SMTP if configured
            if (!process.env.SMTP_HOST) {
                throw new Error('Failed to send OTP email via Resend');
            }
            console.warn('[Email] Falling back to SMTP transport...');
        }
    }

    // 2. Fallback: Use SMTP if configured (Resend SMTP or any provider)
    if (process.env.SMTP_HOST) {
        try {
            const result = await sendMailViaSmtp(mailData);
            console.log(`[Email] OTP sent to ${email} via SMTP (ID: ${result.messageId}) from ${from}`);
            return result;
        } catch (err) {
            console.error('[Email] SMTP delivery failed:', err && err.message ? err.message : err);
            throw new Error('Failed to send OTP email');
        }
    }

    // 3. In development without configured provider, log clearly
    if (process.env.NODE_ENV !== 'production') {
        console.warn(`[DEV MODE] No email provider configured. OTP for ${email} is: ${otp}`);
        return { provider: 'dev-console', accepted: [email], messageId: 'dev-' + Date.now() };
    }

    throw new Error('No email provider configured (RESEND_API_KEY or SMTP_HOST required)');
}

/* ─── Public: Verify Email Provider Connectivity ───────────────────── */
async function verifyEmailConnection() {
    const resend = getResendClient();
    if (resend) {
        return {
            provider: 'resend',
            configured: true,
            from: getSender()
        };
    }
    if (process.env.SMTP_HOST) {
        const tx = getTransporter();
        await tx.verify();
        return { provider: 'smtp', ...getSmtpConfig(), from: getSender() };
    }
    return { provider: 'none', configured: false };
}

async function verifySMTPConnection() {
    return verifyEmailConnection();
}

module.exports = {
    sendOTPEmail,
    verifyEmailConnection,
    verifySMTPConnection,
    getSmtpConfig,
    buildOtpEmailHtml
};
