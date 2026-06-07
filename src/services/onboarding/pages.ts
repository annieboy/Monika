/** Minimal HTML pages for the in-browser bank connection consent flow. */

export function successPage(transactionsImported: number, accountCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bank Connected — Monika</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f0fdf4; display: flex; min-height: 100svh;
           align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: #fff; border-radius: 1rem; padding: 2.5rem 2rem;
            max-width: 400px; width: 100%; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #15803d; margin-bottom: .5rem; }
    p  { color: #374151; line-height: 1.6; margin-bottom: .75rem; font-size: .95rem; }
    .stat { background: #f0fdf4; border-radius: .5rem; padding: .75rem 1rem;
            margin: 1rem 0; font-weight: 600; color: #166534; }
    .cta { margin-top: 1.5rem; font-size: .875rem; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Bank connected!</h1>
    <p>Monika has successfully linked your bank account.</p>
    <div class="stat">
      ${accountCount} account${accountCount === 1 ? '' : 's'} linked &nbsp;·&nbsp;
      ${transactionsImported.toLocaleString()} transactions imported
    </div>
    <p>Your spending insights are ready. Return to WhatsApp and ask me anything about your finances.</p>
    <p class="cta">You can close this window.</p>
  </div>
</body>
</html>`
}

export function failurePage(reason: 'expired' | 'already_used' | 'not_found' | 'error', detail?: string): string {
  const messages: Record<typeof reason, { heading: string; body: string }> = {
    expired: {
      heading: 'Link expired',
      body: 'This connection link has expired (links are valid for 15 minutes). Please ask Monika to send you a new one.',
    },
    already_used: {
      heading: 'Link already used',
      body: 'This connection link has already been used. If you need to reconnect, ask Monika to send a new link.',
    },
    not_found: {
      heading: 'Invalid link',
      body: 'This link is not valid. Please ask Monika to send you a new bank connection link.',
    },
    error: {
      heading: 'Something went wrong',
      body: detail ?? 'An unexpected error occurred. Please try again or ask Monika for a new link.',
    },
  }

  const { heading, body } = messages[reason]

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Failed — Monika</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #fef2f2; display: flex; min-height: 100svh;
           align-items: center; justify-content: center; padding: 1.5rem; }
    .card { background: #fff; border-radius: 1rem; padding: 2.5rem 2rem;
            max-width: 400px; width: 100%; text-align: center;
            box-shadow: 0 4px 24px rgba(0,0,0,.08); }
    .icon { font-size: 3rem; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; font-weight: 700; color: #b91c1c; margin-bottom: .5rem; }
    p  { color: #374151; line-height: 1.6; font-size: .95rem; }
    .cta { margin-top: 1.5rem; font-size: .875rem; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">❌</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    <p class="cta">You can close this window and return to WhatsApp.</p>
  </div>
</body>
</html>`
}
