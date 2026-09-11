// Monvera Digital Banking — Server-Side Transactional SMS Service
// Supports Twilio, Termii, and standard REST SMS gateways

export interface SmsDispatchParams {
  to: string;
  type: 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY' | 'TRANSFER';
  amount?: number;
  senderName?: string;
  recipientName?: string;
  referenceNumber?: string;
  currency?: string;
  customMessage?: string;
}

export interface SmsDispatchResult {
  success: boolean;
  delivered: boolean;
  status: 'SENT' | 'UNCONFIGURED_PROVIDER' | 'FAILED' | 'INVALID_PHONE' | 'DUPLICATE_IGNORED' | 'DISABLED_BY_USER';
  messageId?: string;
  provider?: string;
  error?: string;
}

class SmsService {
  // Idempotency cache to prevent duplicate SMS deliveries
  private sentCache = new Set<string>();

  /**
   * Format and validate phone numbers into clean E.164-compatible numbers
   */
  public sanitizePhoneNumber(rawPhone: string): string | null {
    if (!rawPhone) return null;
    const cleaned = rawPhone.trim().replace(/[^\d+]/g, '');
    if (cleaned.length < 8) return null;
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('0') && cleaned.length === 11) {
      // Common Nigerian format 080... -> +23480...
      return `+234${cleaned.slice(1)}`;
    }
    // Default fallback to US +1 if standard 10 digits
    if (cleaned.length === 10) return `+1${cleaned}`;
    return `+${cleaned}`;
  }

  /**
   * Build concise, compliant Monvera SMS message
   */
  private formatMessage(params: SmsDispatchParams): string {
    if (params.customMessage) return params.customMessage;

    const curr = params.currency || 'USD';
    const currSymbol = curr === 'USD' ? '$' : curr === 'NGN' ? '₦' : `${curr} `;
    const formattedAmt = params.amount !== undefined
      ? `${currSymbol}${params.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : '';
    const ref = params.referenceNumber || `MV-${Date.now().toString().slice(-6)}`;

    switch (params.type) {
      case 'MONEY_RECEIVED':
        return `Monvera: Credit alert! You received ${formattedAmt} from ${params.senderName || 'Bennett Johnson'}. Ref: ${ref}. Funds available.`;
      case 'MONEY_SENT':
      case 'TRANSFER':
        return `Monvera: Debit alert. You sent ${formattedAmt} to ${params.recipientName || 'Monvera Account'}. Ref: ${ref}.`;
      case 'SECURITY':
        return `Monvera Security Alert: New activity or login detected on your account. If this was not you, lock your cards in your dashboard immediately.`;
      default:
        return `Monvera Bank: Account notification for reference ${ref}.`;
    }
  }

  /**
   * Dispatch SMS with deduplication and fail-safe error isolation
   */
  public async sendTransactionSms(params: SmsDispatchParams): Promise<SmsDispatchResult> {
    const dedupeKey = `${params.referenceNumber || ''}_${params.type}_SMS_${params.to}`;
    if (params.referenceNumber && this.sentCache.has(dedupeKey)) {
      console.log(`[SMS Service] Deduplication prevented duplicate SMS for ref: ${params.referenceNumber}`);
      return { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
    }

    const phone = this.sanitizePhoneNumber(params.to);
    if (!phone) {
      console.warn(`[SMS Service] Invalid or missing phone number: "${params.to}". Skipping SMS.`);
      return { success: true, delivered: false, status: 'INVALID_PHONE', error: 'Invalid phone format' };
    }

    const body = this.formatMessage(params);

    // 1. Check Twilio configuration
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER;

    // 2. Check Termii configuration (Nigerian gateway)
    const termiiKey = process.env.TERMII_API_KEY;

    try {
      if (twilioSid && twilioAuth && twilioPhone) {
        // Send via Twilio REST API
        const authHeader = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
        const postData = new URLSearchParams({
          To: phone,
          From: twilioPhone,
          Body: body,
        });

        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: postData.toString(),
        });

        if (res.ok) {
          const json: any = await res.json();
          this.sentCache.add(dedupeKey);
          console.log(`[SMS Service] Twilio SMS dispatched successfully to ${phone}. SID: ${json.sid}`);
          return { success: true, delivered: true, status: 'SENT', messageId: json.sid, provider: 'twilio' };
        } else {
          const errText = await res.text();
          console.error(`[SMS Service] Twilio API error: ${errText}`);
          return { success: true, delivered: false, status: 'FAILED', error: errText, provider: 'twilio' };
        }
      } else if (termiiKey) {
        // Send via Termii REST API
        const res = await fetch('https://api.ng.termii.com/api/sms/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: phone.replace(/^\+/, ''),
            from: process.env.TERMII_SENDER_ID || 'Monvera',
            sms: body,
            type: 'plain',
            channel: 'generic',
            api_key: termiiKey,
          }),
        });

        if (res.ok) {
          const json: any = await res.json();
          this.sentCache.add(dedupeKey);
          console.log(`[SMS Service] Termii SMS sent successfully to ${phone}. ID: ${json.message_id || json.messageId}`);
          return { success: true, delivered: true, status: 'SENT', messageId: json.message_id, provider: 'termii' };
        } else {
          const errText = await res.text();
          console.error(`[SMS Service] Termii API error: ${errText}`);
          return { success: true, delivered: false, status: 'FAILED', error: errText, provider: 'termii' };
        }
      } else {
        // Provider credentials not yet present in environment
        // Mark as cached to prevent repetitive logs, and log structured mock event
        this.sentCache.add(dedupeKey);
        console.log(`[SMS Service - Staging/Ready] SMS triggered for ${phone}: "${body}" (TWILIO_ACCOUNT_SID / TERMII_API_KEY not configured in .env)`);
        return {
          success: true,
          delivered: false,
          status: 'UNCONFIGURED_PROVIDER',
          provider: 'none',
        };
      }
    } catch (err: any) {
      console.error('[SMS Service] Internal delivery failure:', err?.message || err);
      // Ensure financial transactions are never compromised
      return { success: true, delivered: false, status: 'FAILED', error: err?.message };
    }
  }
}

export const smsService = new SmsService();
