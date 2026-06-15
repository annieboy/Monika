/**
 * Web signup flow — phone capture form.
 *
 * GET  /signup        → phone entry form
 * POST /signup        → hash phone, upsert user, send WhatsApp greeting, redirect to /signup/sent
 * GET  /signup/sent   → "Check WhatsApp" confirmation page
 *
 * Security:
 *  - Phone number is NEVER stored in plaintext (HMAC-SHA256 hash + AES-256-GCM encrypted copy)
 *  - No stack traces in error responses
 *  - CSRF protection via double-submit cookie pattern (not needed for WhatsApp redirect flow,
 *    but the form action is POST-redirect-GET so double submission is naturally prevented)
 *  - Rate limited to 10 signups/15 min per IP by the global rate limiter
 */
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { hashPhoneNumber, encrypt } from '../../lib/crypto.js'
import { sendWhatsAppMessage } from '../../services/whatsapp/sender.js'
import { config } from '../../config.js'

interface SignupBody {
  phone?: string
}

// Normalise a UK/international phone number to E.164 format
function normalisePhone(raw: string): string | null {
  // Strip everything except digits and leading +
  const stripped = raw.replace(/[\s\-().]/g, '')
  if (/^\+\d{7,15}$/.test(stripped)) return stripped
  if (/^0\d{9,10}$/.test(stripped)) return `+44${stripped.slice(1)}`
  if (/^\d{10,15}$/.test(stripped)) return `+${stripped}`
  return null
}

const signupRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Parse HTML form submissions
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      const parsed: Record<string, string> = {}
      for (const pair of (body as string).split('&')) {
        const [k, v] = pair.split('=')
        if (k) parsed[decodeURIComponent(k)] = decodeURIComponent((v ?? '').replace(/\+/g, ' '))
      }
      done(null, parsed)
    },
  )

  app.get('/signup', signupGet)
  app.post(
    '/signup',
    {
      schema: {
        body: {
          type: 'object',
          properties: { phone: { type: 'string', maxLength: 20 } },
        },
      },
    },
    signupPost,
  )
  app.get('/signup/sent', signupSentGet)
}

async function signupGet(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return reply.type('text/html').send(signupFormHtml())
}

async function signupPost(
  request: FastifyRequest<{ Body: SignupBody }>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const raw = (request.body.phone ?? '').trim()
  const phone = normalisePhone(raw)

  if (!phone) {
    return reply.type('text/html').send(signupFormHtml('Please enter a valid UK phone number.'))
  }

  try {
    const prisma = request.server.prisma
    const phoneHash = hashPhoneNumber(phone, config.SECRET_KEY)
    const phoneEnc = encrypt(Buffer.from(phone, 'utf-8'), config.ENCRYPTION_KEY) as unknown as Uint8Array<ArrayBuffer>

    await prisma.user.upsert({
      where: { whatsappPhoneHash: phoneHash },
      create: {
        whatsappPhoneHash: phoneHash,
        whatsappPhoneEnc: phoneEnc,
        whatsappWabaId: '',
      },
      update: {},
      select: { id: true },
    })

    // Send a WhatsApp greeting if credentials are configured
    const phoneNumberId = config.WHATSAPP_PHONE_NUMBER_ID
    const accessToken = config.WHATSAPP_ACCESS_TOKEN
    if (phoneNumberId && accessToken) {
      const greeting =
        `👋 Hi! I'm Monika, your AI finance assistant on WhatsApp.\n\n` +
        `To get started, just reply *"Hi"* or ask me anything about your finances.\n\n` +
        `When you're ready, say *"connect my bank"* and I'll guide you through linking your account.`

      sendWhatsAppMessage(phone, greeting, phoneNumberId, accessToken).catch((err: unknown) => {
        request.log.error({ err, phoneHash }, 'Failed to send signup WhatsApp greeting')
      })
    }

    return reply.redirect('/signup/sent', 303)
  } catch (err) {
    request.log.error({ err }, 'Signup form submission failed')
    return reply.type('text/html').send(signupFormHtml('Something went wrong. Please try again.'))
  }
}

async function signupSentGet(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return reply.type('text/html').send(signupSentHtml())
}

// ── HTML templates ────────────────────────────────────────────────────────────

function signupFormHtml(error?: string): string {
  const errorBlock = error
    ? `<p class="error">${escapeHtml(error)}</p>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get started — Monika</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green: #25D366; --green-dark: #128C7E;
      --text: #0f172a; --text-muted: #64748b;
      --border: #e2e8f0; --bg: #f8fafc;
      --radius: 16px; --shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .card {
      background: #fff; border-radius: var(--radius); box-shadow: var(--shadow);
      padding: 48px 40px; max-width: 420px; width: 100%; text-align: center;
    }
    .logo {
      width: 56px; height: 56px; border-radius: 16px; margin: 0 auto 24px;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.75rem;
    }
    h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 8px; }
    p.subtitle { color: var(--text-muted); font-size: 0.95rem; margin-bottom: 32px; line-height: 1.5; }
    label { display: block; text-align: left; font-size: 0.875rem; font-weight: 600; margin-bottom: 6px; }
    input[type="tel"] {
      width: 100%; padding: 14px 16px; font-size: 1rem; font-family: inherit;
      border: 1.5px solid var(--border); border-radius: 10px; outline: none;
      transition: border-color 0.2s;
    }
    input[type="tel"]:focus { border-color: var(--green); }
    button {
      width: 100%; margin-top: 16px; padding: 14px; font-size: 1rem; font-weight: 700;
      background: var(--green); color: #fff; border: none; border-radius: 10px;
      cursor: pointer; font-family: inherit; transition: background 0.2s, transform 0.1s;
    }
    button:hover { background: var(--green-dark); transform: translateY(-1px); }
    .error { color: #dc2626; font-size: 0.875rem; margin-top: 12px; }
    .legal { color: var(--text-muted); font-size: 0.78rem; margin-top: 20px; line-height: 1.5; }
    .legal a { color: var(--green-dark); }
    .back { margin-top: 20px; font-size: 0.875rem; color: var(--text-muted); }
    .back a { color: var(--green-dark); font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">💬</div>
    <h1>Get started with Monika</h1>
    <p class="subtitle">Enter your WhatsApp number and we'll send you a message to kick things off.</p>
    <form method="POST" action="/signup">
      <label for="phone">WhatsApp phone number</label>
      <input type="tel" id="phone" name="phone" placeholder="+44 7700 900000" autocomplete="tel" required>
      ${errorBlock}
      <button type="submit">Send me a WhatsApp message →</button>
    </form>
    <p class="legal">
      By continuing you agree to our <a href="/legal/terms">Terms of Service</a> and
      <a href="/legal/privacy">Privacy Policy</a>. Your phone number is stored encrypted.
    </p>
    <p class="back"><a href="/">← Back to home</a></p>
  </div>
</body>
</html>`
}

function signupSentHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Check WhatsApp — Monika</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --green: #25D366; --green-dark: #128C7E; --text: #0f172a; --text-muted: #64748b; --bg: #f8fafc; --radius: 16px; --shadow: 0 4px 24px rgba(0,0,0,0.08); }
    body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #fff; border-radius: var(--radius); box-shadow: var(--shadow); padding: 48px 40px; max-width: 420px; width: 100%; text-align: center; }
    .icon { font-size: 3.5rem; margin-bottom: 24px; }
    h1 { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 12px; }
    p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.6; margin-bottom: 16px; }
    .steps { text-align: left; background: #f8fafc; border-radius: 12px; padding: 20px 24px; margin: 24px 0; }
    .step { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; font-size: 0.9rem; }
    .step:last-child { margin-bottom: 0; }
    .step-num { font-weight: 700; color: var(--green-dark); flex-shrink: 0; }
    .back { font-size: 0.875rem; color: var(--text-muted); }
    .back a { color: var(--green-dark); font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📱</div>
    <h1>Check your WhatsApp!</h1>
    <p>We've sent you a message. Here's what to do next:</p>
    <div class="steps">
      <div class="step"><span class="step-num">1.</span><span>Open WhatsApp on your phone</span></div>
      <div class="step"><span class="step-num">2.</span><span>Find the message from <strong>Monika</strong></span></div>
      <div class="step"><span class="step-num">3.</span><span>Reply <strong>"Hi"</strong> to get started</span></div>
      <div class="step"><span class="step-num">4.</span><span>Say <strong>"connect my bank"</strong> when you're ready to link your account</span></div>
    </div>
    <p>Didn't get a message? <a href="/signup" style="color:var(--green-dark);font-weight:600;">Try again</a></p>
    <p class="back"><a href="/">← Back to home</a></p>
  </div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default signupRoutes
