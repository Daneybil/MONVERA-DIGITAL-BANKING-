// Monvera Digital Banking — Server-Side Transactional Email Service
// Supports Resend, SendGrid, and standard transactional email providers

export interface EmailDispatchParams {
  to: string;
  recipientName?: string;
  subject?: string;
  type: 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY' | 'INVESTMENT';
  amount?: number;
  senderName?: string;
  referenceNumber?: string;
  accountMasked?: string;
  currency?: string;
  timestamp?: string;
  description?: string;
}

export interface EmailDispatchResult {
  success: boolean;
  delivered: boolean;
  status: 'SENT' | 'UNCONFIGURED_PROVIDER' | 'FAILED' | 'INVALID_EMAIL' | 'DUPLICATE_IGNORED' | 'DISABLED_BY_USER';
  messageId?: string;
  provider?: string;
  error?: string;
}

class EmailService {
  private sentCache = new Set<string>();

  /**
   * Validate standard email format
   */
  public isValidEmail(email: string): boolean {
    if (!email) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.trim());
  }

  /**
   * Generate high-contrast, luxury Monvera HTML email
   */
  private generateHtmlTemplate(params: EmailDispatchParams): { html: string; text: string } {
    const amountStr = params.amount !== undefined
      ? `$${params.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : '';
    const dateStr = params.timestamp
      ? new Date(params.timestamp).toUTCString()
      : new Date().toUTCString();
    const ref = params.referenceNumber || `MV-${Date.now().toString().slice(-6)}`;
    const recipient = params.recipientName || 'Monvera Client';
    const isCredit = params.type === 'MONEY_RECEIVED';

    const title = isCredit ? 'Money Received' : params.type === 'MONEY_SENT' ? 'Money Sent' : 'Security Alert';
    const highlightColor = isCredit ? '#10b981' : '#38bdf8';
    const badgeText = isCredit ? 'CREDIT NOTICE' : 'DEBIT NOTICE';

    const textFallback = `
Monvera Digital Bank — Official Transaction Notice
--------------------------------------------------
Dear ${recipient},

${isCredit ? `You have received ${amountStr} into your Monvera account.` : `You have sent ${amountStr} from your Monvera account.`}

Transaction Details:
• Reference: ${ref}
• Amount: ${amountStr} USD
• ${isCredit ? 'Sender' : 'Recipient'}: ${isCredit ? (params.senderName || 'Bennett Johnson') : (params.recipientName || 'Client')}
• Account: ${params.accountMasked || 'Monvera Premier Checking (•••• 0001)'}
• Date & Time: ${dateStr}
• Status: COMPLETED

Security Note:
Monvera Digital Bank staff will NEVER ask for your password, PIN, or two-factor authentication codes.
--------------------------------------------------
Monvera Digital Banking | Premier Private Wealth & Treasury
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Monvera</title>
</head>
<body style="margin: 0; padding: 0; background-color: #030712; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f9fafb;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #030712; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #0f172a; border-radius: 16px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%); border-bottom: 1px solid #334155;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 20px; font-weight: 900; letter-spacing: 2px; color: #ffffff;">MONVERA</div>
                    <div style="font-size: 11px; letter-spacing: 1px; color: #10b981; font-weight: 700; text-transform: uppercase;">Private Wealth & Digital Banking</div>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 6px 12px; background-color: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; border-radius: 9999px; font-size: 11px; font-weight: 800; color: #34d399; letter-spacing: 0.5px;">${badgeText}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 24px 32px;">
              <div style="font-size: 13px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">Transaction Confirmation</div>
              <h1 style="margin: 8px 0 24px 0; font-size: 26px; font-weight: 800; color: #ffffff;">${title}</h1>

              <!-- Amount Card -->
              <div style="background-color: #020617; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 28px;">
                <div style="font-size: 12px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Total Settled Amount</div>
                <div style="font-size: 38px; font-weight: 900; color: ${highlightColor}; margin: 8px 0;">${isCredit ? '+' : '-'}${amountStr} <span style="font-size: 16px; color: #64748b; font-weight: 600;">USD</span></div>
                <div style="display: inline-block; padding: 4px 10px; background-color: #1e293b; border-radius: 6px; font-size: 11px; color: #cbd5e1; font-family: monospace;">STATUS: COMPLETED</div>
              </div>

              <!-- Transaction Meta Table -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="font-size: 14px; margin-bottom: 28px;">
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8;">Reference Number</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #f1f5f9; font-weight: 700; font-family: monospace;">${ref}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8;">${isCredit ? 'Sender' : 'Recipient'}</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #f1f5f9; font-weight: 600;">${isCredit ? (params.senderName || 'Bennett Johnson') : (params.recipientName || 'Client')}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8;">Beneficiary Account</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #f1f5f9; font-weight: 600;">${params.accountMasked || 'Monvera Premier Checking'}</td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8;">Timestamp</td>
                  <td align="right" style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #f1f5f9; font-weight: 600;">${dateStr}</td>
                </tr>
              </table>

              <!-- Security Box -->
              <div style="background-color: rgba(30, 41, 59, 0.5); border-left: 3px solid #10b981; padding: 14px 16px; border-radius: 4px; font-size: 12px; line-height: 1.6; color: #94a3b8;">
                <strong style="color: #f1f5f9;">Security Protection Notice:</strong> Monvera Digital Banking will never contact you requesting your online banking password, debit card PIN, or two-factor authentication codes.
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px 32px 32px; background-color: #0b0f19; border-top: 1px solid #1e293b; text-align: center; font-size: 11px; color: #64748b; line-height: 1.5;">
              <div>Monvera Global Banking Systems Inc. • 200 Park Avenue, New York, NY 10166</div>
              <div style="margin-top: 4px;">Automated transactional notice. Please do not reply directly to this message.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return { html, text: textFallback };
  }

  /**
   * Dispatch transactional email with deduplication and fail-safe behavior
   */
  public async sendTransactionalEmail(params: EmailDispatchParams): Promise<EmailDispatchResult> {
    const dedupeKey = `${params.referenceNumber || ''}_${params.type}_EMAIL_${params.to}`;
    if (params.referenceNumber && this.sentCache.has(dedupeKey)) {
      console.log(`[Email Service] Deduplication prevented duplicate email for ref: ${params.referenceNumber}`);
      return { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
    }

    if (!this.isValidEmail(params.to)) {
      console.warn(`[Email Service] Invalid email address: "${params.to}". Skipping email.`);
      return { success: true, delivered: false, status: 'INVALID_EMAIL', error: 'Invalid recipient email' };
    }

    const { html, text } = this.generateHtmlTemplate(params);
    const subject = params.subject || (params.type === 'MONEY_RECEIVED' ? 'Money Received — Monvera Digital Bank' : 'Transaction Confirmation — Monvera');

    const resendKey = process.env.RESEND_API_KEY;
    const sendgridKey = process.env.SENDGRID_API_KEY;
    const fromAddress = process.env.EMAIL_FROM || 'Monvera Digital Bank <notifications@monvera.com>';

    try {
      if (resendKey) {
        // Send via Resend REST API
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [params.to],
            subject,
            html,
            text,
          }),
        });

        if (res.ok) {
          const json: any = await res.json();
          this.sentCache.add(dedupeKey);
          console.log(`[Email Service] Resend email dispatched to ${params.to}. ID: ${json.id}`);
          return { success: true, delivered: true, status: 'SENT', messageId: json.id, provider: 'resend' };
        } else {
          const errText = await res.text();
          console.error(`[Email Service] Resend API error: ${errText}`);
          return { success: true, delivered: false, status: 'FAILED', error: errText, provider: 'resend' };
        }
      } else if (sendgridKey) {
        // Send via SendGrid v3 API
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sendgridKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to }] }],
            from: { email: fromAddress.match(/<(.+)>/)?.[1] || fromAddress, name: 'Monvera Digital Bank' },
            subject,
            content: [
              { type: 'text/plain', value: text },
              { type: 'text/html', value: html },
            ],
          }),
        });

        if (res.ok || res.status === 202) {
          this.sentCache.add(dedupeKey);
          console.log(`[Email Service] SendGrid email sent to ${params.to}`);
          return { success: true, delivered: true, status: 'SENT', provider: 'sendgrid' };
        } else {
          const errText = await res.text();
          console.error(`[Email Service] SendGrid API error: ${errText}`);
          return { success: true, delivered: false, status: 'FAILED', error: errText, provider: 'sendgrid' };
        }
      } else {
        // Provider credentials not set in environment
        this.sentCache.add(dedupeKey);
        console.log(`[Email Service - Staging/Ready] Transactional email prepared for ${params.to}: "${subject}" (RESEND_API_KEY / SENDGRID_API_KEY not configured in .env)`);
        return {
          success: true,
          delivered: false,
          status: 'UNCONFIGURED_PROVIDER',
          provider: 'none',
        };
      }
    } catch (err: any) {
      console.error('[Email Service] Internal delivery failure:', err?.message || err);
      // Ensure financial transactions are never compromised
      return { success: true, delivered: false, status: 'FAILED', error: err?.message };
    }
  }
}

export const emailService = new EmailService();
