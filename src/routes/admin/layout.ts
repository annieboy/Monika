/**
 * Shared HTML layout for the internal admin dashboard.
 * Plain HTML + inline CSS — no build step, no JS framework.
 */

export function layout(title: string, body: string, breadcrumbs?: { label: string; href?: string }[]): string {
  const crumbHtml = breadcrumbs
    ? `<nav class="breadcrumbs">${breadcrumbs
        .map((c) =>
          c.href ? `<a href="${c.href}">${c.label}</a>` : `<span>${c.label}</span>`,
        )
        .join(' / ')}</nav>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Monika Admin</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f8fafc; color: #1e293b; display: flex; min-height: 100vh; }

    /* ── Sidebar ─────────────────────────────────────────────────── */
    aside { width: 220px; background: #0f172a; color: #cbd5e1; flex-shrink: 0;
            display: flex; flex-direction: column; padding: 1.5rem 0; }
    aside .logo { padding: 0 1.25rem 1.5rem; font-size: 1.1rem; font-weight: 700;
                  color: #f8fafc; border-bottom: 1px solid #1e293b; margin-bottom: 1rem; }
    aside .logo span { color: #818cf8; }
    aside nav a { display: block; padding: .55rem 1.25rem; color: #94a3b8;
                  text-decoration: none; font-size: .875rem; border-radius: 0;
                  transition: background .15s, color .15s; }
    aside nav a:hover, aside nav a.active { background: #1e293b; color: #f1f5f9; }
    aside nav .section { padding: .75rem 1.25rem .25rem; font-size: .7rem;
                         text-transform: uppercase; letter-spacing: .08em; color: #475569; }
    aside footer { margin-top: auto; padding: 1rem 1.25rem; font-size: .75rem;
                   color: #475569; border-top: 1px solid #1e293b; }
    aside footer a { color: #64748b; text-decoration: none; }
    aside footer a:hover { color: #94a3b8; }

    /* ── Main content ────────────────────────────────────────────── */
    main { flex: 1; overflow-x: auto; }
    .topbar { background: #fff; border-bottom: 1px solid #e2e8f0; padding: .875rem 2rem;
              display: flex; align-items: center; justify-content: space-between; }
    .topbar h1 { font-size: 1.125rem; font-weight: 600; }
    .topbar .meta { font-size: .8rem; color: #64748b; }
    .breadcrumbs { font-size: .8rem; color: #64748b; margin-bottom: .25rem; }
    .breadcrumbs a { color: #6366f1; text-decoration: none; }
    .content { padding: 2rem; }

    /* ── Cards ───────────────────────────────────────────────────── */
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: .75rem;
            padding: 1.5rem; margin-bottom: 1.5rem; }
    .card-title { font-size: .875rem; font-weight: 600; color: #64748b;
                  text-transform: uppercase; letter-spacing: .06em; margin-bottom: 1rem; }

    /* ── Stat grid ───────────────────────────────────────────────── */
    .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
             gap: 1rem; margin-bottom: 2rem; }
    .stat { background: #fff; border: 1px solid #e2e8f0; border-radius: .75rem;
            padding: 1.25rem; }
    .stat-value { font-size: 2rem; font-weight: 700; color: #0f172a; }
    .stat-label { font-size: .8rem; color: #64748b; margin-top: .25rem; }

    /* ── Tables ──────────────────────────────────────────────────── */
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: .875rem; }
    thead th { background: #f1f5f9; padding: .75rem 1rem; text-align: left;
               font-size: .75rem; text-transform: uppercase; letter-spacing: .06em;
               color: #64748b; font-weight: 600; border-bottom: 1px solid #e2e8f0; }
    tbody td { padding: .75rem 1rem; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    tbody tr:hover td { background: #f8fafc; }
    tbody tr:last-child td { border-bottom: none; }

    /* ── Badges ──────────────────────────────────────────────────── */
    .badge { display: inline-block; padding: .15rem .55rem; border-radius: 9999px;
             font-size: .7rem; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
    .badge-green  { background: #dcfce7; color: #166534; }
    .badge-red    { background: #fee2e2; color: #991b1b; }
    .badge-yellow { background: #fef9c3; color: #854d0e; }
    .badge-blue   { background: #dbeafe; color: #1e40af; }
    .badge-gray   { background: #f1f5f9; color: #475569; }
    .badge-purple { background: #ede9fe; color: #5b21b6; }

    /* ── Forms ───────────────────────────────────────────────────── */
    .search-bar { display: flex; gap: .5rem; margin-bottom: 1.5rem; }
    .search-bar input { flex: 1; padding: .5rem .875rem; border: 1px solid #e2e8f0;
                        border-radius: .5rem; font-size: .875rem; outline: none;
                        max-width: 420px; }
    .search-bar input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,.15); }
    .search-bar button { padding: .5rem 1rem; background: #6366f1; color: #fff;
                         border: none; border-radius: .5rem; cursor: pointer;
                         font-size: .875rem; font-weight: 500; }
    .search-bar button:hover { background: #4f46e5; }

    /* ── Links ───────────────────────────────────────────────────── */
    a.row-link { color: #6366f1; text-decoration: none; font-weight: 500; }
    a.row-link:hover { text-decoration: underline; }

    /* ── Code / mono ─────────────────────────────────────────────── */
    .mono { font-family: 'SF Mono', ui-monospace, monospace; font-size: .8rem;
            background: #f1f5f9; padding: .1rem .35rem; border-radius: .25rem; }

    /* ── Detail grid ─────────────────────────────────────────────── */
    .detail-grid { display: grid; grid-template-columns: 200px 1fr; gap: .5rem 1.5rem;
                   font-size: .875rem; }
    .detail-grid dt { color: #64748b; font-weight: 500; padding: .4rem 0; }
    .detail-grid dd { padding: .4rem 0; border-bottom: 1px solid #f1f5f9; word-break: break-all; }

    /* ── Amount colouring ────────────────────────────────────────── */
    .amount-debit  { color: #dc2626; font-weight: 500; }
    .amount-credit { color: #16a34a; font-weight: 500; }

    /* ── Pagination ──────────────────────────────────────────────── */
    .pagination { display: flex; gap: .5rem; margin-top: 1rem; font-size: .875rem; }
    .pagination a { padding: .35rem .75rem; border: 1px solid #e2e8f0; border-radius: .375rem;
                    color: #6366f1; text-decoration: none; }
    .pagination a:hover { background: #f1f5f9; }
    .pagination .current { padding: .35rem .75rem; border: 1px solid #6366f1;
                           border-radius: .375rem; background: #6366f1; color: #fff; }

    /* ── Alert ───────────────────────────────────────────────────── */
    .alert { padding: .875rem 1rem; border-radius: .5rem; margin-bottom: 1rem; font-size: .875rem; }
    .alert-info { background: #dbeafe; color: #1e40af; }

    /* ── JSON block ──────────────────────────────────────────────── */
    pre.json { background: #0f172a; color: #94a3b8; padding: 1rem; border-radius: .5rem;
               font-size: .78rem; overflow-x: auto; line-height: 1.5; }
  </style>
</head>
<body>
  <aside>
    <div class="logo">Monika <span>Admin</span></div>
    <nav>
      <div class="section">Overview</div>
      <a href="/admin">Dashboard</a>
      <div class="section">Users</div>
      <a href="/admin/users">Users</a>
      <div class="section">Data</div>
      <a href="/admin/transactions">Transactions</a>
      <a href="/admin/audit">Audit Log</a>
    </nav>
    <footer>
      <div>Read-only &middot; MVP</div>
      <a href="/admin/logout">Sign out</a>
    </footer>
  </aside>

  <main>
    <div class="topbar">
      <div>
        ${crumbHtml}
        <h1>${title}</h1>
      </div>
      <div class="meta">Internal admin &middot; not for production</div>
    </div>
    <div class="content">
      ${body}
    </div>
  </main>
</body>
</html>`
}

// ── HTML helpers ──────────────────────────────────────────────────────────────

export function badge(text: string, colour: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple'): string {
  return `<span class="badge badge-${colour}">${esc(text)}</span>`
}

export function mono(text: string): string {
  return `<span class="mono">${esc(text)}</span>`
}

export function rowLink(href: string, text: string): string {
  return `<a class="row-link" href="${href}">${esc(text)}</a>`
}

/** HTML-escape a string so untrusted DB content cannot inject markup. */
export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' })
}

export function fmtAmount(amount: unknown, type?: string): string {
  const n = Number(amount)
  const abs = Math.abs(n).toFixed(2)
  const sign = n < 0 ? '-' : '+'
  const cls = n < 0 || type === 'debit' ? 'amount-debit' : 'amount-credit'
  return `<span class="${cls}">${sign}£${abs}</span>`
}

export function paginate(total: number, page: number, limit: number, baseUrl: string): string {
  const totalPages = Math.ceil(total / limit)
  if (totalPages <= 1) return ''
  const prev = page > 1 ? `<a href="${baseUrl}?page=${page - 1}">← Prev</a>` : ''
  const next = page < totalPages ? `<a href="${baseUrl}?page=${page + 1}">Next →</a>` : ''
  return `<div class="pagination">${prev}<span class="current">${page} / ${totalPages}</span>${next}</div>`
}
