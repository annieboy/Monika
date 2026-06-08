/**
 * Legal pages — Privacy Policy and Terms of Service.
 * Required by TrueLayer production access and GDPR.
 */
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'

const BRAND = 'Monika'
const CONTACT_EMAIL = 'bezl@firstguide.co.uk'
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
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 780px; margin: 0 auto; padding: 48px 24px 80px; color: #1a1a1a; line-height: 1.7; font-size: 16px; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 1.1rem; font-weight: 600; margin-top: 2.5rem; margin-bottom: 0.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 6px; }
    h3 { font-size: 1rem; font-weight: 600; margin-top: 1.25rem; margin-bottom: 0.25rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 2.5rem; }
    .intro { background: #f5f9ff; border-left: 4px solid #0066cc; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 2rem; }
    .security-box { background: #f0faf4; border: 1px solid #b7e4c7; border-radius: 8px; padding: 20px 24px; margin: 1.5rem 0; }
    .security-box h3 { margin-top: 0; color: #1a7f3c; }
    a { color: #0066cc; }
    ul { padding-left: 1.5rem; }
    li { margin-bottom: 0.4rem; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
    th { background: #f5f5f5; text-align: left; padding: 10px 14px; border: 1px solid #ddd; font-weight: 600; }
    td { padding: 10px 14px; border: 1px solid #ddd; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid #e5e5e5; color: #666; font-size: 0.875rem; }
  </style>
</head>
<body>${body}
<footer>
  <p>${BRAND} · <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a> · <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
</footer>
</body>
</html>`
}

function privacyPolicyHtml(): string {
  return pageShell('Privacy Policy', `
  <h1>Privacy Policy</h1>
  <p class="meta">Effective date: ${EFFECTIVE_DATE} &nbsp;·&nbsp; Last updated: ${EFFECTIVE_DATE}</p>

  <div class="intro">
    <strong>What is Monika?</strong> Monika is a UK personal finance assistant that works over WhatsApp. You connect your bank account using open banking (powered by TrueLayer), and Monika reads your transactions, balances, and subscriptions to answer your financial questions — like "How much did I spend on groceries?" or "Can I afford a £400k mortgage?" Monika is read-only and cannot make payments or transfers on your behalf.
  </div>

  <h2>1. Who we are</h2>
  <p>${BRAND} is operated as a UK-based service. The data controller for your personal data is First Guide. For all data protection queries, contact us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>2. What financial data we collect</h2>
  <p>We collect the following financial data with your explicit open banking consent:</p>

  <table>
    <tr><th>Data type</th><th>What it includes</th><th>Why we collect it</th></tr>
    <tr>
      <td><strong>Account information</strong></td>
      <td>Account name, type (current/savings/credit), currency, last 4 digits of account number, sort code</td>
      <td>To identify and display your accounts in responses</td>
    </tr>
    <tr>
      <td><strong>Balances</strong></td>
      <td>Current balance and available balance for each account</td>
      <td>To answer balance and affordability questions</td>
    </tr>
    <tr>
      <td><strong>Transactions</strong></td>
      <td>Date, amount, merchant name, category, transaction type (debit/credit) — up to 90 days</td>
      <td>To analyse spending, detect subscriptions, and answer financial questions</td>
    </tr>
    <tr>
      <td><strong>OAuth access tokens</strong></td>
      <td>The token TrueLayer issues that allows us to read your data</td>
      <td>To fetch your bank data on your behalf — stored encrypted, never shared</td>
    </tr>
  </table>

  <p>We also collect:</p>
  <ul>
    <li><strong>Phone number</strong> — collected when you message us via WhatsApp. Stored as a one-way HMAC-SHA256 hash (cannot be reversed). Where needed to send you outbound messages, an encrypted copy is also stored using AES-256-GCM encryption.</li>
    <li><strong>Conversation history</strong> — messages you send to ${BRAND} and our responses, stored to provide context across sessions.</li>
    <li><strong>Usage analytics</strong> — anonymised events (e.g. "spending query received") to improve the service. These contain no personally identifiable information.</li>
  </ul>

  <h2>3. Why we collect it — legal bases (UK GDPR)</h2>
  <ul>
    <li><strong>Contract performance (Art. 6(1)(b))</strong> — processing bank data and messages is necessary to deliver the service you signed up for.</li>
    <li><strong>Consent (Art. 6(1)(a))</strong> — open banking access requires your explicit consent via TrueLayer's authorisation flow. You can withdraw this at any time.</li>
    <li><strong>Legitimate interests (Art. 6(1)(f))</strong> — fraud prevention, security monitoring, and service improvement, where these do not override your rights.</li>
  </ul>

  <h2>4. How long we retain your data</h2>
  <table>
    <tr><th>Data type</th><th>Retention period</th></tr>
    <tr><td>Transaction data</td><td>Up to 12 months from the transaction date</td></tr>
    <tr><td>Account balances</td><td>Updated on each sync; historical snapshots kept for 90 days</td></tr>
    <tr><td>Conversation history</td><td>For the lifetime of your account</td></tr>
    <tr><td>OAuth access tokens</td><td>Until you disconnect your bank or delete your account</td></tr>
    <tr><td>Phone number (encrypted)</td><td>Until you delete your account, then immediately erased</td></tr>
    <tr><td>Audit logs</td><td>Up to 7 years (anonymised after account deletion, for fraud prevention and regulatory compliance)</td></tr>
  </table>
  <p>When you request account deletion, all personal data is erased within <strong>30 days</strong>. Bank connections are revoked with TrueLayer immediately.</p>

  <h2>5. How to revoke consent and disconnect your bank</h2>
  <p>You can revoke open banking consent at any time. When you do, we immediately call TrueLayer's revocation API to cancel our access token, and your bank connection is marked as revoked in our system. We no longer fetch any new data from your bank after revocation.</p>
  <p>To revoke consent:</p>
  <ul>
    <li>Message Monika on WhatsApp: <em>"disconnect my bank"</em></li>
    <li>Email us at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and we will action it within 24 hours</li>
    <li>You can also revoke directly in your bank's app under "Connected apps" or "Open banking permissions"</li>
  </ul>
  <p>Revoking consent does not delete your account or transaction history. To delete all data, see Section 7.</p>

  <h2>6. Data sharing</h2>
  <p>We do not sell, rent, or share your personal data for marketing purposes. Data is shared only with the following sub-processors:</p>
  <ul>
    <li><strong>TrueLayer Ltd</strong> — FCA-authorised open banking provider (Firm Reference Number: 793171). They act as the Account Information Service Provider on your behalf. <a href="https://truelayer.com/legal/privacy-policy" target="_blank">TrueLayer Privacy Policy →</a></li>
    <li><strong>Anthropic PBC</strong> — AI provider that processes your financial questions to generate responses. Under our API agreement, data submitted via the API is not used for model training. Queries are processed transiently.</li>
    <li><strong>Render Inc</strong> — cloud hosting provider. Our servers and database are hosted in the EU (Frankfurt). Render processes data under a Data Processing Agreement.</li>
    <li><strong>Meta Platforms (WhatsApp)</strong> — messaging infrastructure. Message delivery is handled by Meta under their Business Terms. We do not share financial data with Meta — only message content you send us.</li>
  </ul>

  <div class="security-box">
    <h3>🔒 Security — how we protect your data</h3>

    <h3>Are OAuth tokens encrypted?</h3>
    <p>Yes. All OAuth access tokens and refresh tokens issued by TrueLayer are encrypted at rest using <strong>AES-256-GCM</strong> with a random 96-bit nonce before being written to the database. The encryption key is stored separately from the database and is never logged or transmitted. Even if the database were compromised, tokens would be unreadable.</p>

    <h3>Are secrets and credentials encrypted?</h3>
    <p>Yes. All sensitive fields — including phone numbers (where stored for outbound messaging), account sort codes, account numbers, and full name — are encrypted at rest using AES-256-GCM. Phone numbers are additionally stored as a one-way HMAC-SHA256 hash for lookup purposes, meaning the original number cannot be derived from the stored value.</p>

    <h3>Who can access transaction data?</h3>
    <p>Access to transaction data is strictly controlled:</p>
    <ul>
      <li>Transaction data is only read when you ask Monika a question — it is never shared outside the service</li>
      <li>Our admin dashboard is protected by HTTP Basic Authentication with a strong password, and is accessible only to authorised operators</li>
      <li>No employee or operator can read your raw OAuth tokens — these are encrypted and only decrypted by the application at runtime when fetching your bank data</li>
      <li>Anthropic receives a financial summary (spending totals, balance figures) to generate responses — not raw transaction records or account numbers</li>
    </ul>

    <h3>How are audit logs stored?</h3>
    <p>All consent events (bank connection, disconnection, account deletion) are recorded in an append-only audit log. Audit log entries are <strong>never updated or deleted</strong> — they form an immutable record for compliance and fraud prevention. IP addresses in audit logs are stored as one-way hashes, not in plaintext. After account deletion, audit logs are anonymised (user ID is disassociated) but retained for up to 7 years as required by financial regulations.</p>

    <h3>Transport security</h3>
    <p>All connections to Monika use TLS 1.2 or higher. Webhook payloads from Meta (WhatsApp) are verified using HMAC-SHA256 signature verification before processing — unauthenticated requests are rejected.</p>
  </div>

  <h2>7. Your rights (UK GDPR)</h2>
  <ul>
    <li><strong>Right of access (Art. 15)</strong> — request a copy of all personal data we hold about you</li>
    <li><strong>Right to erasure (Art. 17)</strong> — request deletion of your account and all personal data</li>
    <li><strong>Right to portability (Art. 20)</strong> — receive your data in a machine-readable JSON format</li>
    <li><strong>Right to rectification (Art. 16)</strong> — request correction of inaccurate personal data</li>
    <li><strong>Right to withdraw consent</strong> — disconnect your bank at any time (see Section 5)</li>
    <li><strong>Right to object (Art. 21)</strong> — object to processing based on legitimate interests</li>
    <li><strong>Right to complain</strong> — lodge a complaint with the Information Commissioner's Office (ICO) at <a href="https://ico.org.uk" target="_blank">ico.org.uk</a> or by calling 0303 123 1113</li>
  </ul>
  <p>To exercise any right, email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>. We will respond within <strong>30 days</strong>.</p>

  <h2>8. Cookies</h2>
  <p>Monika operates via WhatsApp and does not use cookies or tracking pixels. Our web pages (this privacy policy, bank connection flow) do not set any cookies.</p>

  <h2>9. Changes to this policy</h2>
  <p>We will notify you of material changes via WhatsApp message at least 14 days before they take effect. The effective date at the top of this page will be updated. Continued use of the service after the effective date constitutes acceptance.</p>

  <h2>10. Contact us</h2>
  <p>For any privacy-related queries, data subject requests, or complaints:</p>
  <p><strong>Email:</strong> <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a><br>
  We aim to respond to all enquiries within 5 working days.</p>
`)
}

function termsOfServiceHtml(): string {
  return pageShell('Terms of Service', `
  <h1>Terms of Service</h1>
  <p class="meta">Effective date: ${EFFECTIVE_DATE}</p>

  <div class="intro">
    <strong>What is Monika?</strong> Monika is a UK personal finance assistant accessible via WhatsApp. Using open banking, Monika securely connects to your bank account (read-only) and answers financial questions — such as your spending breakdown, account balance, subscription costs, and affordability estimates. Monika does not make payments, move money, or provide regulated financial advice.
  </div>

  <h2>1. The service</h2>
  <p>${BRAND} is operated by First Guide as a read-only financial information service. By connecting your bank account, Monika can:</p>
  <ul>
    <li>Show your account balances and recent transactions</li>
    <li>Analyse your spending by category and merchant</li>
    <li>Detect recurring subscriptions and direct debits</li>
    <li>Estimate how much you can safely spend</li>
    <li>Answer affordability questions (e.g. mortgage estimates)</li>
    <li>Identify unusual or unexpected transactions</li>
  </ul>
  <p>Monika <strong>cannot</strong> make payments, initiate transfers, change your bank details, or take any action on your accounts. Access is strictly read-only.</p>

  <h2>2. Eligibility</h2>
  <p>You must be:</p>
  <ul>
    <li>At least 18 years old</li>
    <li>A UK resident</li>
    <li>The authorised holder of the bank account you connect</li>
  </ul>
  <p>By using Monika, you confirm all of the above.</p>

  <h2>3. Open banking consent</h2>
  <p>Bank connectivity is provided by <strong>TrueLayer Ltd</strong>, an FCA-authorised Account Information Service Provider (AISP, FRN: 793171). When you connect your bank, you are granting TrueLayer (on behalf of Monika) read-only access to your account data under the UK Open Banking Standard.</p>
  <p>You may revoke this consent at any time by:</p>
  <ul>
    <li>Messaging Monika: <em>"disconnect my bank"</em></li>
    <li>Emailing <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></li>
    <li>Revoking access directly in your bank's app</li>
  </ul>
  <p>Revoking consent stops all future data access. Existing transaction data may be retained as described in our <a href="/privacy">Privacy Policy</a>.</p>

  <h2>4. Financial information disclaimer</h2>
  <p>${BRAND} provides <strong>information and analysis only</strong>. Nothing Monika tells you constitutes financial advice. Monika is not regulated by the Financial Conduct Authority (FCA) to provide financial advice or investment recommendations.</p>
  <p>You should not make significant financial decisions — including mortgage applications, investment choices, or major purchases — based solely on information provided by Monika. Always consult a qualified, FCA-authorised financial adviser for advice tailored to your situation.</p>
  <p>Affordability estimates (e.g. mortgage calculations) are indicative only and based on publicly available formulas. Lenders will apply their own criteria.</p>

  <h2>5. Accuracy of information</h2>
  <p>We display data as received from your bank via the open banking API. We are not responsible for errors, delays, or omissions in data provided by your bank or TrueLayer. AI-generated responses may contain inaccuracies or misinterpretations — always verify important figures directly with your bank before acting on them.</p>

  <h2>6. Your responsibilities</h2>
  <p>You agree not to use ${BRAND} to:</p>
  <ul>
    <li>Attempt to gain unauthorised access to any system or data</li>
    <li>Submit false, misleading, or fraudulent information</li>
    <li>Use the service on behalf of another person without their knowledge and consent</li>
    <li>Reverse-engineer, scrape, or reproduce any part of the service</li>
    <li>Engage in any activity that violates applicable UK or EU law</li>
  </ul>

  <h2>7. Intellectual property</h2>
  <p>All content, code, branding, and materials relating to ${BRAND} are the property of First Guide. You may not reproduce, distribute, or create derivative works without our written permission.</p>

  <h2>8. Availability</h2>
  <p>We aim to provide a reliable service but do not guarantee uninterrupted availability. We may perform maintenance, updates, or suspend the service without notice. We are not liable for losses caused by service downtime.</p>

  <h2>9. Termination</h2>
  <p>We may suspend or terminate your access to ${BRAND} if you breach these Terms, engage in abusive behaviour, or if we are required to do so by law. You may terminate your account at any time by requesting deletion of your data at <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>

  <h2>10. Limitation of liability</h2>
  <p>To the maximum extent permitted by applicable law, First Guide and ${BRAND} are not liable for any indirect, incidental, consequential, or punitive damages arising from your use of or inability to use the service, including but not limited to financial losses resulting from reliance on information provided by Monika.</p>
  <p>Our total aggregate liability to you for any claim shall not exceed <strong>£100</strong>.</p>
  <p>Nothing in these Terms limits our liability for death or personal injury caused by negligence, fraud, or any other liability that cannot be excluded by law.</p>

  <h2>11. Governing law</h2>
  <p>These Terms are governed by and construed in accordance with the laws of <strong>England and Wales</strong>. Any disputes shall be subject to the exclusive jurisdiction of the courts of England and Wales.</p>

  <h2>12. Changes to these Terms</h2>
  <p>We may update these Terms from time to time. We will notify you of material changes via WhatsApp at least 14 days before they take effect. Continued use of the service after that date constitutes your acceptance of the updated Terms.</p>

  <h2>13. Contact</h2>
  <p><strong>First Guide / Monika</strong><br>
  Email: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>
  <p>See also our <a href="/privacy">Privacy Policy</a>.</p>
`)
}

export default legalRoutes
