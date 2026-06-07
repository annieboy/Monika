/**
 * Admin authentication middleware.
 *
 * Uses HTTP Basic Auth — credentials compared with timingSafeEqual to
 * prevent timing side-channels. Credentials are server-side env vars only;
 * no secrets are transmitted beyond the initial Basic Auth exchange.
 */
import { timingSafeEqual } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../../config.js'

const REALM = 'Monika Admin'

function safeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) {
    // Still run comparison to avoid timing leak on length difference
    timingSafeEqual(ba, Buffer.alloc(ba.length))
    return false
  }
  return timingSafeEqual(ba, bb)
}

export function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const header = request.headers['authorization'] ?? ''

  if (!header.startsWith('Basic ')) {
    void reply
      .status(401)
      .header('WWW-Authenticate', `Basic realm="${REALM}"`)
      .header('Content-Type', 'text/html')
      .send(loginPage(''))
    return false
  }

  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colonIdx = decoded.indexOf(':')
  if (colonIdx === -1) {
    void reply.status(401).header('WWW-Authenticate', `Basic realm="${REALM}"`).send('Unauthorized')
    return false
  }

  const user = decoded.slice(0, colonIdx)
  const pass = decoded.slice(colonIdx + 1)

  const validUser = safeEq(user, config.ADMIN_USERNAME)
  const validPass = safeEq(pass, config.ADMIN_PASSWORD)

  if (!validUser || !validPass) {
    void reply
      .status(401)
      .header('WWW-Authenticate', `Basic realm="${REALM}"`)
      .header('Content-Type', 'text/html')
      .send(loginPage('Invalid username or password.'))
    return false
  }

  return true
}

function loginPage(error: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Sign in — Monika Admin</title>
  <style>
    body { font-family: -apple-system, sans-serif; background: #0f172a;
           display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .box { background: #1e293b; border-radius: 1rem; padding: 2.5rem;
           width: 100%; max-width: 360px; color: #f1f5f9; }
    h1 { font-size: 1.25rem; margin-bottom: .25rem; }
    p { font-size: .85rem; color: #94a3b8; margin-bottom: 1.5rem; }
    .err { color: #f87171; font-size: .85rem; margin-bottom: 1rem; }
    input { width: 100%; padding: .6rem .875rem; background: #0f172a; border: 1px solid #334155;
            border-radius: .5rem; color: #f1f5f9; font-size: .875rem; margin-bottom: .75rem; outline: none; }
    input:focus { border-color: #6366f1; }
    button { width: 100%; padding: .65rem; background: #6366f1; color: #fff;
             border: none; border-radius: .5rem; font-size: .875rem; cursor: pointer; }
    button:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Monika Admin</h1>
    <p>Internal dashboard — authorised access only</p>
    ${error ? `<div class="err">${error}</div>` : ''}
    <form method="POST" action="/admin/login">
      <input type="text" name="username" placeholder="Username" autocomplete="username" required>
      <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`
}
