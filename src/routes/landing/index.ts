import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

const WHATSAPP_NUMBER = '+15556572407'
const WHATSAPP_LINK = `https://wa.me/15556572407?text=Hi%20Monika!`

const landingRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/', async (_request, reply) => {
    return reply.type('text/html').send(landingHtml())
  })
}

function landingHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monika — Your AI Finance Assistant on WhatsApp</title>
  <meta name="description" content="Monika connects to your UK bank account and answers your financial questions on WhatsApp. Check your balance, track spending, find subscriptions, and plan your finances — just by asking.">
  <meta property="og:title" content="Monika — Your AI Finance Assistant on WhatsApp">
  <meta property="og:description" content="Ask your finances anything. Monika connects to your bank and answers on WhatsApp.">
  <meta property="og:type" content="website">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    /* ── Reset & base ─────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --green: #25D366;
      --green-dark: #128C7E;
      --green-light: #dcfce7;
      --indigo: #4f46e5;
      --indigo-light: #eef2ff;
      --text: #0f172a;
      --text-muted: #64748b;
      --border: #e2e8f0;
      --bg: #ffffff;
      --bg-subtle: #f8fafc;
      --radius: 16px;
      --shadow: 0 4px 24px rgba(0,0,0,0.08);
      --shadow-lg: 0 20px 60px rgba(0,0,0,0.12);
    }
    html { scroll-behavior: smooth; }
    body { font-family: 'Inter', -apple-system, sans-serif; color: var(--text); background: var(--bg); line-height: 1.6; -webkit-font-smoothing: antialiased; }
    img { display: block; max-width: 100%; }
    a { color: inherit; text-decoration: none; }

    /* ── Nav ──────────────────────────────────────────── */
    nav {
      position: sticky; top: 0; z-index: 100;
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 32px;
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
    }
    .nav-logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.25rem; letter-spacing: -0.5px; }
    .nav-logo .logo-icon {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem;
    }
    .nav-links { display: flex; align-items: center; gap: 32px; }
    .nav-links a { font-size: 0.9rem; font-weight: 500; color: var(--text-muted); transition: color 0.2s; }
    .nav-links a:hover { color: var(--text); }
    .nav-cta {
      background: var(--green); color: #fff !important;
      padding: 10px 20px; border-radius: 10px; font-weight: 600; font-size: 0.875rem;
      transition: background 0.2s, transform 0.1s;
      display: flex; align-items: center; gap: 8px;
    }
    .nav-cta:hover { background: var(--green-dark); transform: translateY(-1px); }

    /* ── Hero ─────────────────────────────────────────── */
    .hero {
      min-height: 92vh;
      display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: 80px;
      padding: 80px 80px 80px 80px;
      max-width: 1280px; margin: 0 auto;
    }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 8px;
      background: var(--green-light); color: #166534;
      padding: 6px 14px; border-radius: 100px; font-size: 0.8rem; font-weight: 600;
      margin-bottom: 24px;
    }
    .hero-badge span { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; animation: pulse 2s infinite; }
    @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.4} }
    h1 {
      font-size: clamp(2.5rem, 5vw, 4rem);
      font-weight: 900; line-height: 1.1; letter-spacing: -2px;
      margin-bottom: 24px;
    }
    h1 em { font-style: normal; color: var(--green-dark); }
    .hero-sub {
      font-size: 1.15rem; color: var(--text-muted); line-height: 1.7;
      margin-bottom: 40px; max-width: 480px;
    }
    .hero-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .btn-primary {
      display: inline-flex; align-items: center; gap: 10px;
      background: var(--green); color: #fff;
      padding: 16px 28px; border-radius: 14px; font-weight: 700; font-size: 1rem;
      box-shadow: 0 4px 20px rgba(37,211,102,0.4);
      transition: all 0.2s;
    }
    .btn-primary:hover { background: var(--green-dark); transform: translateY(-2px); box-shadow: 0 8px 30px rgba(37,211,102,0.4); }
    .btn-secondary {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--text-muted); font-weight: 500; font-size: 0.95rem;
      padding: 16px 20px; border-radius: 14px; border: 1.5px solid var(--border);
      transition: all 0.2s;
    }
    .btn-secondary:hover { border-color: var(--text); color: var(--text); }
    .hero-number { font-size: 0.85rem; color: var(--text-muted); margin-top: 16px; }
    .hero-number strong { color: var(--text); }

    /* ── Phone mockup ─────────────────────────────────── */
    .phone-wrap { position: relative; display: flex; justify-content: center; }
    .phone {
      width: 320px;
      background: #fff;
      border-radius: 40px;
      box-shadow: var(--shadow-lg), 0 0 0 10px #1a1a1a, 0 0 0 12px #333;
      overflow: hidden;
      position: relative;
    }
    .phone-status {
      background: #075e54; color: #fff;
      padding: 12px 20px 8px;
      display: flex; align-items: center; gap: 12px;
    }
    .phone-avatar {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.1rem; flex-shrink: 0;
    }
    .phone-contact { flex: 1; }
    .phone-contact .name { font-weight: 600; font-size: 0.95rem; }
    .phone-contact .status { font-size: 0.72rem; opacity: 0.8; }
    .phone-body { background: #ece5dd; padding: 16px 12px; height: 480px; max-height: 480px; overflow-y: scroll; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; scrollbar-width: none; }
    .phone-body::-webkit-scrollbar { display: none; }
    .msg { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 0.82rem; line-height: 1.5; position: relative; }
    .msg-time { font-size: 0.65rem; opacity: 0.6; margin-top: 4px; text-align: right; }
    .msg.user { background: #dcf8c6; margin-left: auto; border-radius: 12px 2px 12px 12px; }
    .msg.bot { background: #fff; margin-right: auto; border-radius: 2px 12px 12px 12px; }
    .msg strong { display: block; margin-bottom: 4px; font-size: 0.78rem; color: #128C7E; }
    .phone-input {
      background: #fff; padding: 10px 14px;
      display: flex; align-items: center; gap: 10px;
      border-top: 1px solid #ddd;
    }
    .phone-input input { flex: 1; border: none; outline: none; font-size: 0.82rem; color: #666; background: none; }
    .phone-input .send-btn {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--green); display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 0.9rem; flex-shrink: 0;
    }
    .floating-card {
      position: absolute;
      background: #fff; border-radius: 14px;
      box-shadow: var(--shadow-lg);
      padding: 14px 18px;
      font-size: 0.8rem;
      animation: float 4s ease-in-out infinite;
    }
    @keyframes float { 0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)} }
    .floating-card.left { left: -60px; top: 140px; animation-delay: 0s; }
    .floating-card.right { right: -60px; top: 300px; animation-delay: 1.5s; }
    .fc-label { font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px; }
    .fc-value { font-weight: 700; font-size: 1.1rem; }
    .fc-value.green { color: var(--green-dark); }
    .fc-value.indigo { color: var(--indigo); }

    /* ── Trust bar ────────────────────────────────────── */
    .trust-bar {
      border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
      padding: 20px 80px;
      display: flex; align-items: center; justify-content: center; gap: 48px;
      flex-wrap: wrap; background: var(--bg-subtle);
    }
    .trust-item { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; font-weight: 500; color: var(--text-muted); }
    .trust-icon { font-size: 1.2rem; }

    /* ── Section shared ───────────────────────────────── */
    section { padding: 100px 80px; max-width: 1280px; margin: 0 auto; }
    .section-label { font-size: 0.75rem; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--green-dark); margin-bottom: 12px; }
    .section-title { font-size: clamp(1.8rem, 3vw, 2.6rem); font-weight: 800; letter-spacing: -1px; margin-bottom: 16px; line-height: 1.2; }
    .section-sub { font-size: 1.05rem; color: var(--text-muted); max-width: 560px; line-height: 1.7; }

    /* ── How it works ─────────────────────────────────── */
    .how-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px; margin-top: 60px; }
    .step {
      position: relative; padding: 32px;
      background: var(--bg-subtle); border-radius: var(--radius);
      border: 1.5px solid var(--border);
      transition: all 0.25s;
    }
    .step:hover { border-color: var(--green); box-shadow: 0 8px 32px rgba(37,211,102,0.12); transform: translateY(-4px); }
    .step-num {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      color: #fff; font-weight: 800; font-size: 1.1rem;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 20px;
    }
    .step h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 10px; }
    .step p { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; }
    .step-connector { position: absolute; top: 54px; right: -22px; color: var(--border); font-size: 1.4rem; z-index: 1; }

    /* ── Questions ────────────────────────────────────── */
    .questions-section { background: var(--text); color: #fff; border-radius: 32px; margin: 0 40px; padding: 80px; }
    .questions-section .section-label { color: var(--green); }
    .questions-section .section-sub { color: rgba(255,255,255,0.6); }
    .q-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-top: 48px; }
    .q-card {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px; padding: 20px 22px;
      display: flex; gap: 14px; align-items: flex-start;
      transition: background 0.2s;
    }
    .q-card:hover { background: rgba(255,255,255,0.1); }
    .q-icon { font-size: 1.4rem; flex-shrink: 0; margin-top: 2px; }
    .q-card h4 { font-size: 0.9rem; font-weight: 600; margin-bottom: 4px; }
    .q-card p { font-size: 0.82rem; color: rgba(255,255,255,0.5); line-height: 1.5; }

    /* ── Features ─────────────────────────────────────── */
    .features-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 56px; }
    .feat {
      padding: 28px; border-radius: var(--radius);
      border: 1.5px solid var(--border);
      transition: all 0.25s;
    }
    .feat:hover { border-color: #a5b4fc; box-shadow: 0 8px 32px rgba(79,70,229,0.08); transform: translateY(-3px); }
    .feat-icon {
      width: 48px; height: 48px; border-radius: 12px;
      background: var(--indigo-light); color: var(--indigo);
      display: flex; align-items: center; justify-content: center;
      font-size: 1.3rem; margin-bottom: 16px;
    }
    .feat h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
    .feat p { font-size: 0.875rem; color: var(--text-muted); line-height: 1.6; }

    /* ── Chat demo ────────────────────────────────────── */
    .demo-section { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
    .demo-chat {
      background: var(--bg-subtle); border-radius: 24px;
      border: 1.5px solid var(--border);
      overflow: hidden; box-shadow: var(--shadow);
    }
    .demo-chat-header {
      background: #075e54; color: #fff;
      padding: 16px 20px; display: flex; align-items: center; gap: 12px;
    }
    .demo-chat-header .avatar {
      width: 40px; height: 40px; border-radius: 50%;
      background: var(--green); display: flex; align-items: center; justify-content: center; font-size: 1.1rem;
    }
    .demo-chat-header .info .name { font-weight: 600; font-size: 0.95rem; }
    .demo-chat-header .info .sub { font-size: 0.72rem; opacity: 0.75; }
    .demo-chat-body { padding: 20px; display: flex; flex-direction: column; gap: 12px; background: #ece5dd; }
    .dc-msg { max-width: 82%; padding: 10px 14px; border-radius: 12px; font-size: 0.85rem; line-height: 1.55; }
    .dc-msg.user { background: #dcf8c6; margin-left: auto; border-radius: 12px 2px 12px 12px; }
    .dc-msg.bot { background: #fff; margin-right: auto; border-radius: 2px 12px 12px 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
    .dc-msg .tick { font-size: 0.7rem; color: #53bdeb; float: right; margin-left: 8px; margin-top: 2px; }
    .dc-tabs { display: flex; gap: 10px; margin-bottom: 32px; flex-wrap: wrap; }
    .dc-tab {
      padding: 8px 16px; border-radius: 100px; font-size: 0.8rem; font-weight: 600;
      border: 1.5px solid var(--border); color: var(--text-muted); cursor: pointer;
      transition: all 0.2s;
    }
    .dc-tab.active { background: var(--green); border-color: var(--green); color: #fff; }
    .dc-tab:hover:not(.active) { border-color: var(--green); color: var(--green-dark); }

    /* ── Security ─────────────────────────────────────── */
    .security-section { background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: #fff; border-radius: 32px; margin: 0 40px; padding: 80px; }
    .security-section .section-label { color: #6ee7b7; }
    .security-section .section-sub { color: rgba(255,255,255,0.6); }
    .sec-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin-top: 48px; }
    .sec-card {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px; padding: 28px;
    }
    .sec-card .icon { font-size: 2rem; margin-bottom: 14px; }
    .sec-card h3 { font-size: 1rem; font-weight: 700; margin-bottom: 8px; }
    .sec-card p { font-size: 0.85rem; color: rgba(255,255,255,0.55); line-height: 1.6; }
    .sec-card .badge {
      display: inline-block; margin-top: 10px;
      background: rgba(110,231,183,0.15); color: #6ee7b7;
      padding: 4px 12px; border-radius: 100px; font-size: 0.72rem; font-weight: 600;
    }

    /* ── Stats ────────────────────────────────────────── */
    .stats-strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1.5px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-top: 60px; }
    .stat { padding: 36px 32px; text-align: center; border-right: 1.5px solid var(--border); }
    .stat:last-child { border-right: none; }
    .stat-value { font-size: 2.4rem; font-weight: 900; letter-spacing: -2px; color: var(--text); }
    .stat-value span { color: var(--green-dark); }
    .stat-label { font-size: 0.85rem; color: var(--text-muted); margin-top: 4px; }

    /* ── CTA ──────────────────────────────────────────── */
    .cta-section {
      text-align: center; padding: 100px 80px;
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #f0fdf4 100%);
      border-radius: 32px; margin: 0 40px;
    }
    .cta-section h2 { font-size: clamp(2rem, 4vw, 3rem); font-weight: 900; letter-spacing: -1.5px; margin-bottom: 16px; }
    .cta-section p { font-size: 1.05rem; color: var(--text-muted); max-width: 500px; margin: 0 auto 40px; line-height: 1.7; }
    .cta-wa {
      display: inline-flex; align-items: center; gap: 12px;
      background: var(--green); color: #fff;
      padding: 18px 36px; border-radius: 16px; font-weight: 700; font-size: 1.1rem;
      box-shadow: 0 8px 40px rgba(37,211,102,0.4);
      transition: all 0.2s;
    }
    .cta-wa:hover { background: var(--green-dark); transform: translateY(-3px); box-shadow: 0 16px 50px rgba(37,211,102,0.4); }
    .cta-wa svg { width: 26px; height: 26px; }
    .cta-note { font-size: 0.85rem; color: var(--text-muted); margin-top: 20px; }
    .cta-number { font-weight: 700; color: var(--text); font-size: 1rem; margin-top: 8px; }

    /* ── Footer ───────────────────────────────────────── */
    footer {
      border-top: 1px solid var(--border);
      padding: 48px 80px;
      display: grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap: 48px;
      max-width: 1280px; margin: 60px auto 0;
    }
    .footer-brand { max-width: 280px; }
    .footer-brand .logo { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 1.1rem; margin-bottom: 12px; }
    .footer-brand .logo .licon {
      width: 32px; height: 32px; border-radius: 8px;
      background: linear-gradient(135deg, var(--green) 0%, var(--green-dark) 100%);
      display: flex; align-items: center; justify-content: center; font-size: 1rem;
    }
    .footer-brand p { font-size: 0.875rem; color: var(--text-muted); line-height: 1.6; }
    .footer-col h4 { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; color: var(--text-muted); }
    .footer-col a { display: block; font-size: 0.875rem; color: var(--text-muted); margin-bottom: 10px; transition: color 0.2s; }
    .footer-col a:hover { color: var(--text); }
    .footer-bottom {
      border-top: 1px solid var(--border);
      padding: 24px 80px;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 0.8rem; color: var(--text-muted);
      max-width: 1280px; margin: 0 auto;
    }

    /* ── Animations ───────────────────────────────────── */
    @keyframes fadeUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    .fade-up { animation: fadeUp 0.6s ease forwards; }
    .delay-1 { animation-delay: 0.1s; opacity: 0; }
    .delay-2 { animation-delay: 0.2s; opacity: 0; }
    .delay-3 { animation-delay: 0.3s; opacity: 0; }

    /* ── Typewriter ────────────────────────────────────── */
    .typewriter-wrap { min-height: 32px; margin-bottom: 24px; }
    .typewriter {
      font-size: 1rem; font-weight: 600; color: var(--green-dark);
      border-right: 2px solid var(--green);
      white-space: nowrap; overflow: hidden;
      display: inline-block;
      animation: blink 0.75s step-end infinite;
    }
    @keyframes blink { 0%,100%{border-color:var(--green)}50%{border-color:transparent} }

    /* ── Phone chat animation ──────────────────────────── */
    .msg-anim { animation: msgIn 0.35s cubic-bezier(0.34,1.56,0.64,1) forwards; opacity:0; transform: scale(0.8) translateY(10px); }
    @keyframes msgIn { to { opacity:1; transform: scale(1) translateY(0); } }
    .typing-indicator {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 10px 16px; background: #fff;
      border-radius: 2px 12px 12px 12px;
      margin-right: auto; width: fit-content;
    }
    .typing-indicator span {
      width: 7px; height: 7px; border-radius: 50%; background: #aaa;
      animation: typingDot 1.2s ease-in-out infinite;
    }
    .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
    .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typingDot { 0%,60%,100%{transform:translateY(0);background:#aaa}30%{transform:translateY(-5px);background:#555} }
    .chip { display: inline-block; background: #e8f5e9; color: #1a6b3c; border: 1px solid #a8d5b5; border-radius: 16px; padding: 3px 10px; font-size: 0.72rem; margin: 2px 2px; cursor: default; white-space: nowrap; }
    .send-flash { background: #128C7E !important; transform: scale(1.25) !important; transition: transform 0.1s, background 0.1s; }

    /* ── Responsive ───────────────────────────────────── */
    @media (max-width: 1024px) {
      .hero { grid-template-columns: 1fr; padding: 60px 40px; gap: 60px; min-height: auto; }
      .phone-wrap { order: -1; }
      .floating-card { display: none; }
      section { padding: 60px 40px; }
      .how-grid, .features-grid { grid-template-columns: 1fr; }
      .q-grid, .sec-grid { grid-template-columns: 1fr; }
      .demo-section { grid-template-columns: 1fr; }
      .questions-section, .security-section, .cta-section { margin: 0 20px; padding: 60px 40px; }
      footer { grid-template-columns: 1fr 1fr; padding: 48px 40px; }
      .stats-strip { grid-template-columns: 1fr 1fr; }
      .stat { border-right: none; border-bottom: 1.5px solid var(--border); }
      .stat:nth-child(odd) { border-right: 1.5px solid var(--border); }
      .stat:nth-last-child(-n+2) { border-bottom: none; }
    }
    @media (max-width: 640px) {
      nav { padding: 14px 20px; }
      .nav-links { display: none; }
      .hero { padding: 40px 20px; }
      section { padding: 60px 20px; }
      .questions-section, .security-section, .cta-section { margin: 0; border-radius: 0; padding: 60px 24px; }
      footer { grid-template-columns: 1fr; padding: 40px 24px; }
      .footer-bottom { padding: 20px 24px; flex-direction: column; gap: 8px; }
      .stats-strip { grid-template-columns: 1fr 1fr; }
      .trust-bar { padding: 20px 24px; gap: 24px; }
    }
  </style>
</head>
<body>

<!-- ── Nav ── -->
<nav>
  <a href="/" class="nav-logo">
    <div class="logo-icon">💬</div>
    Monika
  </a>
  <div class="nav-links">
    <a href="#how-it-works">How it works</a>
    <a href="#features">Features</a>
    <a href="#security">Security</a>
    <a href="/privacy">Privacy</a>
    <a href="${WHATSAPP_LINK}" target="_blank" class="nav-cta">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
      Chat with Monika
    </a>
  </div>
</nav>

<!-- ── Hero ── -->
<div style="max-width:1280px;margin:0 auto;">
<div class="hero">
  <div>
    <div class="hero-badge fade-up"><span></span> Open Banking · UK Only</div>
    <h1 class="fade-up delay-1">Your bank,<br><em>on WhatsApp.</em></h1>
    <div class="typewriter-wrap fade-up delay-1">
      <span class="typewriter" id="typewriter"></span>
    </div>
    <p class="hero-sub fade-up delay-2">
      Monika connects to your UK bank account and answers your financial questions in seconds — just like texting a friend who happens to be a finance expert.
    </p>
    <div class="hero-actions fade-up delay-3">
      <a href="${WHATSAPP_LINK}" target="_blank" class="btn-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        Start chatting — it's free
      </a>
      <a href="#how-it-works" class="btn-secondary">See how it works →</a>
    </div>
    <p class="hero-number">WhatsApp <strong>${WHATSAPP_NUMBER}</strong></p>
  </div>

  <!-- Phone mockup -->
  <div class="phone-wrap fade-up delay-2">
    <div class="floating-card left">
      <div class="fc-label">Spent this month</div>
      <div class="fc-value indigo">£1,842</div>
    </div>
    <div class="phone">
      <div class="phone-status">
        <div class="phone-avatar">💬</div>
        <div class="phone-contact">
          <div class="name">Monika</div>
          <div class="status">● online</div>
        </div>
      </div>
      <div class="phone-body" id="hero-phone-body">
        <!-- animated by JS -->
      </div>
      <div class="phone-input">
        <input type="text" placeholder="Message" readonly id="hero-input">
        <div class="send-btn" id="hero-send">➤</div>
      </div>
    </div>
    <div class="floating-card right">
      <div class="fc-label">Safe to spend</div>
      <div class="fc-value green">£347</div>
    </div>
  </div>
</div>
</div>

<!-- ── Trust bar ── -->
<div class="trust-bar">
  <div class="trust-item"><span class="trust-icon">🏦</span> TrueLayer Open Banking</div>
  <div class="trust-item"><span class="trust-icon">🔒</span> AES-256-GCM Encrypted</div>
  <div class="trust-item"><span class="trust-icon">🇬🇧</span> UK Banks Supported</div>
  <div class="trust-item"><span class="trust-icon">👁️</span> Read-Only Access</div>
  <div class="trust-item"><span class="trust-icon">🇪🇺</span> UK GDPR Compliant</div>
</div>

<!-- ── How it works ── -->
<section id="how-it-works">
  <div class="section-label">How it works</div>
  <div class="section-title">Up and running in 3 steps</div>
  <p class="section-sub">No app to download. No account to create. Just WhatsApp and your bank.</p>

  <div class="how-grid">
    <div class="step">
      <div class="step-num">1</div>
      <h3>Message Monika on WhatsApp</h3>
      <p>Save Monika's number and send a message. Monika will greet you and send a secure bank connection link — valid for 15 minutes.</p>
      <div class="step-connector">→</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <h3>Connect your UK bank</h3>
      <p>Tap the link and select your bank. Authorise read-only access using your bank's own security — Monika never sees your login details.</p>
      <div class="step-connector">→</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <h3>Ask anything about your money</h3>
      <p>Once connected, Monika imports your last 90 days of transactions. Ask any financial question in plain English — Monika replies in seconds.</p>
    </div>
  </div>
</section>

<!-- ── Questions you can ask ── -->
<div style="padding: 0 0 100px;">
<div class="questions-section">
  <div class="section-label">What to ask</div>
  <div class="section-title" style="color:#fff;">Over 100 questions Monika can answer</div>
  <p class="section-sub">From the everyday to the important — just ask in plain English.</p>

  <div class="q-grid">
    <div class="q-card">
      <div class="q-icon">💳</div>
      <div>
        <h4>"How much did I spend on groceries last month?"</h4>
        <p>Spending breakdown by category, with month-on-month comparison.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🏠</div>
      <div>
        <h4>"Can I afford a £400k mortgage?"</h4>
        <p>Affordability estimate based on your real income and outgoings. Includes estimated repayments.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">💰</div>
      <div>
        <h4>"How much can I safely spend this weekend?"</h4>
        <p>Balance minus upcoming bills and a £50 buffer — your real discretionary number.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🔁</div>
      <div>
        <h4>"What subscriptions am I paying for?"</h4>
        <p>Detects recurring payments automatically — Netflix, Spotify, gym, and more.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">📊</div>
      <div>
        <h4>"What's my balance right now?"</h4>
        <p>Live balance across all connected accounts, with available vs current breakdown.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🚨</div>
      <div>
        <h4>"Any unusual transactions this month?"</h4>
        <p>Spots anomalies — unexpected charges, amounts that are out of the ordinary for you.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">📅</div>
      <div>
        <h4>"When do I get paid next?"</h4>
        <p>Detects your salary pattern and estimates your next payday.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🎯</div>
      <div>
        <h4>"Am I saving enough?"</h4>
        <p>Your savings rate this month vs the 20% benchmark, with a practical assessment.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🧾</div>
      <div>
        <h4>"What bills are due this month?"</h4>
        <p>Upcoming direct debits and subscriptions totalled for the month ahead.</p>
      </div>
    </div>
    <div class="q-card">
      <div class="q-icon">🏪</div>
      <div>
        <h4>"How much have I spent at Tesco?"</h4>
        <p>Spending at any merchant — Deliveroo, Amazon, Costa, Uber — for any period.</p>
      </div>
    </div>
  </div>
</div>
</div>

<!-- ── Chat demo ── -->
<section id="demo" style="max-width:1280px;margin:0 auto;padding:0 80px 100px;">
  <div class="demo-section">
    <div>
      <div class="section-label">Live demo</div>
      <div class="section-title">See Monika in action</div>
      <p class="section-sub" style="margin-bottom:32px;">Real responses from real questions. Monika understands context, speaks British English, and gives you the actual numbers — not vague advice.</p>

      <div class="dc-tabs">
        <div class="dc-tab active" onclick="showChat(0,this)">Spending</div>
        <div class="dc-tab" onclick="showChat(1,this)">Mortgage</div>
        <div class="dc-tab" onclick="showChat(2,this)">Subscriptions</div>
        <div class="dc-tab" onclick="showChat(3,this)">Safe to spend</div>
      </div>

      <a href="${WHATSAPP_LINK}" target="_blank" class="btn-primary" style="display:inline-flex;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        Try it yourself
      </a>
    </div>

    <div class="demo-chat">
      <div class="demo-chat-header">
        <div class="avatar">💬</div>
        <div class="info">
          <div class="name">Monika</div>
          <div class="sub">● online now</div>
        </div>
      </div>
      <div class="demo-chat-body" id="chat-body">
        <!-- populated by JS -->
      </div>
    </div>
  </div>
</section>

<!-- ── Features ── -->
<section id="features" style="max-width:1280px;margin:0 auto;padding:0 80px 100px;">
  <div class="section-label">Features</div>
  <div class="section-title">Everything in one place</div>
  <p class="section-sub">No dashboards. No logging in. Just ask — Monika brings the insight to you.</p>

  <div class="features-grid">
    <div class="feat">
      <div class="feat-icon">📈</div>
      <h3>Spending Analysis</h3>
      <p>See exactly where your money goes — by category, merchant, or time period. Week, month, or custom range.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">🔍</div>
      <h3>Subscription Detection</h3>
      <p>Monika automatically finds recurring payments you may have forgotten about — and tells you the total monthly cost.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">⚖️</div>
      <h3>Affordability Calculator</h3>
      <p>Real affordability checks using your actual income and outgoings — mortgages, big purchases, or monthly budgets.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">🏦</div>
      <h3>Live Balances</h3>
      <p>Current and available balances across all connected accounts, updated every 6 hours automatically.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">⚠️</div>
      <h3>Unusual Transaction Alerts</h3>
      <p>Monika spots anomalies in your spending — unexpected charges, duplicate payments, or amounts that seem off.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">🤖</div>
      <h3>AI-Powered Answers</h3>
      <p>Powered by Claude AI — Monika understands natural language and handles questions no fixed template could predict.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">📅</div>
      <h3>Payday Tracking</h3>
      <p>Detects your salary pattern and tells you when your next payday is, and how much you typically receive.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">💵</div>
      <h3>Savings Rate</h3>
      <p>Calculates your monthly savings rate against the 20% benchmark and tells you honestly if you're on track.</p>
    </div>
    <div class="feat">
      <div class="feat-icon">🗓️</div>
      <h3>Upcoming Bills</h3>
      <p>Know what's coming out before it hits — direct debits, subscriptions, and committed payments for the month ahead.</p>
    </div>
  </div>
</section>

<!-- ── Security ── -->
<div style="padding: 0 0 100px;">
<div class="security-section" id="security">
  <div class="section-label">Security & Privacy</div>
  <div class="section-title" style="color:#fff;">Bank-grade security.<br>No compromises.</div>
  <p class="section-sub">Monika was designed security-first. Your credentials never touch our servers — and everything that does is encrypted.</p>

  <div class="sec-grid">
    <div class="sec-card">
      <div class="icon">🔐</div>
      <h3>AES-256-GCM Encryption</h3>
      <p>Every OAuth token, phone number, and sensitive field is encrypted at rest using AES-256-GCM with a random nonce. The encryption key is stored separately from the database. Even a full database breach exposes nothing readable.</p>
      <span class="badge">Tokens encrypted at rest</span>
    </div>
    <div class="sec-card">
      <div class="icon">👁️</div>
      <h3>Read-Only Access</h3>
      <p>Monika connects via TrueLayer, an FCA-authorised open banking provider. Access is strictly read-only — Monika can see your transactions but cannot initiate payments, transfers, or any changes to your account.</p>
      <span class="badge">Cannot move money</span>
    </div>
    <div class="sec-card">
      <div class="icon">🏛️</div>
      <h3>FCA-Regulated Open Banking</h3>
      <p>Bank connectivity is powered by TrueLayer (FRN: 793171), an FCA-authorised Account Information Service Provider. Your bank authorises access using their own security — your password is never shared with Monika.</p>
      <span class="badge">FCA-authorised provider</span>
    </div>
    <div class="sec-card">
      <div class="icon">📋</div>
      <h3>Immutable Audit Log</h3>
      <p>Every consent event — bank connection, disconnection, deletion — is recorded in an append-only audit log that can never be modified or deleted. You can request a full copy at any time. IP addresses are stored as hashed values only.</p>
      <span class="badge">GDPR Article 30 compliant</span>
    </div>
    <div class="sec-card">
      <div class="icon">🗑️</div>
      <h3>Full Data Deletion</h3>
      <p>You can request complete deletion of your data at any time. When you do, Monika immediately calls TrueLayer's revocation API to cancel your bank access, then erases all personal data. Nothing is kept without your consent.</p>
      <span class="badge">GDPR Article 17 compliant</span>
    </div>
    <div class="sec-card">
      <div class="icon">🛡️</div>
      <h3>HMAC Webhook Verification</h3>
      <p>Every incoming message from WhatsApp is verified using HMAC-SHA256 signature verification before processing. Unauthenticated requests are rejected. All connections use TLS 1.2 or higher.</p>
      <span class="badge">Signature-verified messages</span>
    </div>
  </div>
</div>
</div>

<!-- ── Stats ── -->
<section style="max-width:1280px;margin:0 auto;padding:0 80px 100px;">
  <div class="stats-strip">
    <div class="stat"><div class="stat-value">90<span>d</span></div><div class="stat-label">Transaction history imported</div></div>
    <div class="stat"><div class="stat-value">6<span>hr</span></div><div class="stat-label">Automatic sync interval</div></div>
    <div class="stat"><div class="stat-value">100<span>+</span></div><div class="stat-label">Financial questions answered</div></div>
    <div class="stat"><div class="stat-value">0<span>£</span></div><div class="stat-label">Cost to get started</div></div>
  </div>
</section>

<!-- ── CTA ── -->
<div style="padding: 0 0 100px;">
<div class="cta-section">
  <h2>Start understanding<br>your money today.</h2>
  <p>Save Monika's number, send a message, and connect your bank in under 2 minutes. No app. No signup form. Just WhatsApp.</p>
  <a href="${WHATSAPP_LINK}" target="_blank" class="cta-wa">
    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    Open WhatsApp — Chat with Monika
  </a>
  <p class="cta-note">Or save the number and message us directly</p>
  <p class="cta-number">${WHATSAPP_NUMBER}</p>
</div>
</div>

<!-- ── Footer ── -->
<footer>
  <div class="footer-brand">
    <div class="logo">
      <div class="licon">💬</div>
      Monika
    </div>
    <p>Your AI-powered UK personal finance assistant. Ask anything about your money — just on WhatsApp.</p>
  </div>
  <div class="footer-col">
    <h4>Product</h4>
    <a href="#how-it-works">How it works</a>
    <a href="#features">Features</a>
    <a href="#security">Security</a>
    <a href="${WHATSAPP_LINK}" target="_blank">Chat with Monika</a>
  </div>
  <div class="footer-col">
    <h4>Legal</h4>
    <a href="/privacy">Privacy Policy</a>
    <a href="/terms">Terms of Service</a>
  </div>
  <div class="footer-col">
    <h4>Contact</h4>
    <a href="mailto:bezl@firstguide.co.uk">bezl@firstguide.co.uk</a>
    <a href="${WHATSAPP_LINK}" target="_blank">WhatsApp ${WHATSAPP_NUMBER}</a>
  </div>
</footer>
<div class="footer-bottom">
  <span>© ${new Date().getFullYear()} First Guide / Monika. All rights reserved.</span>
  <span>Powered by TrueLayer open banking · UK GDPR compliant</span>
</div>

<script>
// ── Demo chat tabs ─────────────────────────────────────────────────────────
var chats = [
  [
    {role:"user", text:"How much did I spend on eating out this month?"},
    {role:"bot", text:"You've spent <strong>£312</strong> eating out in June across 18 transactions.<br><br>• Dishoom: £48<br>• Deliveroo: £67<br>• Pret a Manger: £34<br>• Other: £163<br><br>That's £89 more than last month. 📈"},
  ],
  [
    {role:"user", text:"Can I afford a £400k mortgage?"},
    {role:"bot", text:"Based on your average monthly income of <strong>£4,200</strong>, typical lenders would offer £201k–£226k (4–4.5× salary).<br><br>A £400k mortgage would likely be a stretch:<br>• Est. monthly repayment: £2,147 (25yr, ~5%)<br>• Your disposable income: £1,890<br>• Repayment would exceed disposable by £257/mo ⚠️"},
  ],
  [
    {role:"user", text:"What subscriptions am I paying for?"},
    {role:"bot", text:"You have <strong>6 active subscriptions</strong>:<br><br>• Netflix: £17.99/month<br>• Spotify: £10.99/month<br>• Amazon Prime: £8.99/month<br>• Gym: £35.00/month<br>• iCloud: £2.99/month<br>• Disney+: £4.99/month<br><br>Total: <strong>£80.95/month</strong>"},
  ],
  [
    {role:"user", text:"How much can I safely spend this weekend?"},
    {role:"bot", text:"Safe to spend this weekend: <strong>£347</strong><br><br>• Current balance: £1,842<br>• Bills due in 3 days: £1,445<br>• Buffer kept: £50<br><br>Enjoy your weekend! 🎉"},
  ],
];

function showChat(idx, el) {
  document.querySelectorAll(".dc-tab").forEach(function(t){ t.classList.remove("active"); });
  el.classList.add("active");
  var body = document.getElementById("chat-body");
  body.innerHTML = "";
  chats[idx].forEach(function(m) {
    var div = document.createElement("div");
    div.className = "dc-msg " + m.role;
    div.innerHTML = m.text + (m.role==="user" ? '<span class="tick">✓✓</span>' : "");
    body.appendChild(div);
  });
}
showChat(0, document.querySelector(".dc-tab"));

// ── Typewriter ─────────────────────────────────────────────────────────────
var phrases = [
  "How much did I spend this month?",
  "Can I afford a £400k mortgage?",
  "What subscriptions am I paying for?",
  "Safe to spend this weekend?",
  "When do I get paid next?",
  "Any unusual transactions?",
  "What is my balance right now?",
  "Am I saving enough?",
];
var phraseIdx = 0, charIdx = 0, deleting = false;
var tw = document.getElementById("typewriter");
function typeLoop() {
  var phrase = phrases[phraseIdx];
  if (!deleting) {
    charIdx++;
    tw.textContent = phrase.slice(0, charIdx);
    if (charIdx === phrase.length) { deleting = true; setTimeout(typeLoop, 2200); return; }
    setTimeout(typeLoop, 48);
  } else {
    charIdx--;
    tw.textContent = phrase.slice(0, charIdx);
    if (charIdx === 0) {
      deleting = false;
      phraseIdx = (phraseIdx + 1) % phrases.length;
      setTimeout(typeLoop, 400);
      return;
    }
    setTimeout(typeLoop, 22);
  }
}
setTimeout(typeLoop, 800);

// ── Hero phone animation ───────────────────────────────────────────────────
(function() {
  var heroBody = document.getElementById("hero-phone-body");
  var heroInput = document.getElementById("hero-input");
  var heroSend = document.getElementById("hero-send");

  // Each step: type:"user" has text; type:"bot" has html (already formatted, no escaping)
  var steps = [
    {
      type: "user",
      text: "Hello"
    },
    {
      type: "bot",
      html: "<strong>Monika</strong>Hi there! 👋 I am <b>Monika</b>, your AI-powered UK finance assistant.<br><br>What can I do for you today?<br><br><span class=\"chip\">💳 Check balances</span> <span class=\"chip\">📅 Upcoming bills</span> <span class=\"chip\">🏠 Mortgage check</span> <span class=\"chip\">📊 Spending review</span><br><span class=\"chip\">🔁 Subscriptions</span> <span class=\"chip\">💰 Safe to spend</span>"
    },
    {
      type: "user",
      text: "When is my next direct debit?"
    },
    {
      type: "bot",
      html: "<strong>Monika</strong>📅 <b>Upcoming direct debits:</b><br><br>• <b>Rent — £1,200</b> &nbsp;due in 3 days<br>• Council Tax — £142 &nbsp;on 1st<br>• Netflix — £17.99 &nbsp;on 14th<br><br>⚠️ <b>Warning:</b> Your balance is <b>£1,187</b>. After rent you will have <b>–£13</b> — you will be overdrawn. Top up before the 1st."
    },
    {
      type: "user",
      text: "Can I afford a £400k mortgage?"
    },
    {
      type: "bot",
      html: "<strong>Monika</strong>🏠 Based on your income of <b>£4,200/mo</b>:<br><br>• Lender max (4–4.5×): <b>£201k – £226k</b><br>• Est. monthly repayment: <b>£2,147/mo</b><br>• Your disposable income: <b>£1,890/mo</b><br><br>⚠️ A £400k mortgage is a stretch — repayments would exceed your disposable income by <b>£257/mo</b>. Consider a lower amount or increasing your income first."
    }
  ];

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  function nowTime() {
    return new Date().toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit"});
  }

  function appendUserMsg(text) {
    var d = document.createElement("div");
    d.className = "msg user msg-anim";
    d.innerHTML = text + "<div class=\"msg-time\">" + nowTime() + " ✓✓</div>";
    heroBody.appendChild(d);
    heroBody.scrollTop = heroBody.scrollHeight;
  }

  function appendBotMsg(html) {
    var d = document.createElement("div");
    d.className = "msg bot msg-anim";
    d.innerHTML = html + "<div class=\"msg-time\">" + nowTime() + "</div>";
    heroBody.appendChild(d);
    heroBody.scrollTop = heroBody.scrollHeight;
  }

  function appendTyping() {
    var d = document.createElement("div");
    d.className = "typing-indicator msg-anim";
    d.id = "hero-typing";
    d.innerHTML = "<span></span><span></span><span></span>";
    heroBody.appendChild(d);
    heroBody.scrollTop = heroBody.scrollHeight;
    return d;
  }

  async function typeInput(text) {
    heroInput.value = "";
    heroInput.placeholder = "";
    for (var i = 0; i < text.length; i++) {
      heroInput.value += text[i];
      await sleep(55 + Math.random() * 50);
    }
    // Flash send button
    heroSend.classList.add("send-flash");
    await sleep(200);
    heroSend.classList.remove("send-flash");
    heroInput.value = "";
    heroInput.placeholder = "Message";
  }

  async function runLoop() {
    await sleep(800);
    while (true) {
      heroBody.innerHTML = "";
      for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        if (step.type === "user") {
          await typeInput(step.text);
          await sleep(100);
          appendUserMsg(step.text);
          await sleep(600);
        } else {
          var ty = appendTyping();
          // Typing delay proportional to message length, capped
          var typingDelay = Math.min(900 + step.html.replace(/<[^>]+>/g,"").length * 12, 3000);
          await sleep(typingDelay);
          ty.remove();
          appendBotMsg(step.html);
          await sleep(3800);
        }
      }
      await sleep(1200);
    }
  }

  runLoop();
})();
</script>

</body>
</html>`
}

export default landingRoutes
