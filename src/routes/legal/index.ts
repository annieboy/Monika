/**
 * Legal pages — Privacy Policy and Terms of Service.
 * Required by TrueLayer production access and GDPR.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

const BRAND = 'Monika'
const CONTACT_EMAIL = 'privacy@monika.app'
const EFFECTIVE_DATE = '1 June 2025'

const legalRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/privacy', async (_request, reply) => {
    return reply.type('text/html').send(privacyPolicyHtml())
  })

  app.get('/terms', async (_request, reply) => {
    return reply.type('text/html').send(termsOfServiceHtml())
  })
}

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — ${BRAND}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 2rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.2rem; margin-top: 2rem; }
    .meta { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
    a { color: #0066cc; }
    ul { padding-left: 1.5rem; }
  </style>
</head>
<body>${body}</body>
</html>`
}

function privacyPolicyHtml(): string {
  return pageShell('Privacy Policy', `
  <h1>Privacy Policy</h1>
  <p class="meta">Effective date: ${EFFECTIVE_DATE} · Last updated: ${EFFECTIVE_DATE}</p>

  <p>${BRAND} ("we", "us", "our") is a UK personal finance assistant that connects to your bank via open banking to help you understand your finances. This policy explains what data we collect, how we use it, and your rights.</p>

  <h2>1. Who we are</h2>
  <p>${BRAND} is operated as a UK-based service. For data protection queries, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>2. What data we collect</h2>
  <ul>
    <li><strong>Phone number</strong> — collected when you message us via WhatsApp. Stored as a one-way cryptographic hash and, where needed for outbound messages, encrypted with AES-256-GCM.</li>
    <li><strong>Bank account data</strong> — with your explicit consent via TrueLayer's open banking platform: account balances, transaction history (up to 90 days), and account metadata. All OAuth tokens are encrypted at rest using AES-256-GCM.</li>
    <li><strong>Conversation history</strong> — messages you send to ${BRAND} and our responses, stored to provide context for future queries.</li>
    <li><strong>Usage events</strong> — anonymised analytics (e.g. "spending query asked") to improve the service. No personally identifiable information is included in analytics events.</li>
  </ul>

  <h2>3. Legal basis for processing (UK GDPR)</h2>
  <ul>
    <li><strong>Contract performance</strong> — processing your bank data and messages to deliver the service you requested.</li>
    <li><strong>Legitimate interests</strong> — fraud prevention, security, and service improvement.</li>
    <li><strong>Consent</strong> — open banking consent, which you can withdraw at any time.</li>
  </ul>

  <h2>4. How we use your data</h2>
  <ul>
    <li>To answer your finance questions via WhatsApp</li>
    <li>To analyse your spending, subscriptions, and balances</li>
    <li>To send you your bank connection link and notifications</li>
    <li>To improve the accuracy and quality of our responses</li>
  </ul>

  <h2>5. Data sharing</h2>
  <p>We do not sell your data. We share data only with:</p>
  <ul>
    <li><strong>TrueLayer</strong> — our open banking provider, authorised by the FCA. Their privacy policy: <a href="https://truelayer.com/legal/privacy-policy" target="_blank">truelayer.com/legal/privacy-policy</a></li>
    <li><strong>Anthropic</strong> — AI provider used to generate financial summaries. Queries are processed transiently and not used for model training under our API agreement.</li>
    <li><strong>Render / infrastructure providers</strong> — cloud hosting and database services within the EU.</li>
  </ul>

  <h2>6. Data retention</h2>
  <p>We retain your data for as long as your account is active. Transaction data is retained for up to 12 months. On account deletion, all personal data is erased within 30 days. Anonymised audit logs may be retained for up to 7 years for fraud prevention.</p>

  <h2>7. Your rights (UK GDPR)</h2>
  <ul>
    <li><strong>Right of access</strong> — request a copy of your data at any time</li>
    <li><strong>Right to erasure</strong> — request deletion of your account and all personal data</li>
    <li><strong>Right to portability</strong> — receive your data in a machine-readable format</li>
    <li><strong>Right to withdraw consent</strong> — disconnect your bank at any time</li>
    <li><strong>Right to complain</strong> — you may lodge a complaint with the ICO at <a href="https://ico.org.uk" target="_blank">ico.org.uk</a></li>
  </ul>
  <p>To exercise any right, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>8. Security</h2>
  <p>All sensitive data is encrypted at rest using AES-256-GCM. Connections use TLS 1.2+. We conduct regular security reviews. We do not store bank credentials — access is via tokenised open banking consent only.</p>

  <h2>9. Changes to this policy</h2>
  <p>We will notify you of material changes via WhatsApp message. Continued use after notification constitutes acceptance.</p>

  <h2>10. Contact</h2>
  <p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
`)
}

function termsOfServiceHtml(): string {
  return pageShell('Terms of Service', `
  <h1>Terms of Service</h1>
  <p class="meta">Effective date: ${EFFECTIVE_DATE}</p>

  <p>These Terms of Service ("Terms") govern your use of ${BRAND}, a UK personal finance assistant accessible via WhatsApp. By using ${BRAND}, you agree to these Terms.</p>

  <h2>1. The service</h2>
  <p>${BRAND} is a read-only financial information service. We connect to your bank via open banking to provide spending analysis, balance information, subscription detection, and financial insights via WhatsApp. We do not execute payments or transfers.</p>

  <h2>2. Eligibility</h2>
  <p>You must be at least 18 years old and a UK resident to use ${BRAND}. By connecting your bank, you confirm you are the authorised account holder.</p>

  <h2>3. Open banking consent</h2>
  <p>Bank connectivity is provided via TrueLayer, an FCA-authorised Account Information Service Provider (AISP). By connecting your bank, you grant ${BRAND} read-only access to your account data. You may revoke this consent at any time by messaging "disconnect my bank" or contacting us directly.</p>

  <h2>4. Financial information disclaimer</h2>
  <p>${BRAND} provides information and analysis only. Nothing we say constitutes financial advice. We are not regulated by the FCA to provide financial advice. You should not make financial decisions based solely on information provided by ${BRAND}. Always consult a qualified financial adviser for advice specific to your situation.</p>

  <h2>5. Accuracy</h2>
  <p>We display data as received from your bank via open banking. We are not responsible for errors or omissions in data provided by your bank. AI-generated summaries may contain inaccuracies — always verify important figures with your bank directly.</p>

  <h2>6. Prohibited use</h2>
  <p>You must not use ${BRAND} to:</p>
  <ul>
    <li>Attempt to gain unauthorised access to any system</li>
    <li>Submit false or misleading information</li>
    <li>Use the service on behalf of another person without their consent</li>
    <li>Engage in any activity that violates applicable law</li>
  </ul>

  <h2>7. Termination</h2>
  <p>We may suspend or terminate access if you breach these Terms. You may terminate your account at any time by requesting deletion of your data.</p>

  <h2>8. Limitation of liability</h2>
  <p>To the maximum extent permitted by law, ${BRAND} is not liable for any indirect, incidental, or consequential damages arising from your use of the service. Our total liability shall not exceed £100.</p>

  <h2>9. Governing law</h2>
  <p>These Terms are governed by the laws of England and Wales. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

  <h2>10. Changes</h2>
  <p>We may update these Terms. We will notify you of material changes via WhatsApp. Continued use after notice constitutes acceptance.</p>

  <h2>11. Contact</h2>
  <p>Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
`)
}

export default legalRoutes
