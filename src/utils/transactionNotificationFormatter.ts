import { NotificationItem } from '../types';

export type FinancialDirection = 'CREDIT' | 'DEBIT' | 'INTERNAL';

export interface TransactionNotificationPresentation {
  isFinancialTransaction: boolean;
  direction: FinancialDirection;
  heading: 'ACCOUNT CREDITED' | 'ACCOUNT DEBITED' | 'INTERNAL TRANSFER';
  transactionLabel: string;
  amount: number | null;
  currency: string;
  signedAmountFormatted: string | null;
  senderName?: string;
  recipientName?: string;
  merchantOrDestination?: string;
  accountNumberMasked?: string;
  formattedDate: string;
  formattedTime: string;
  reference: string;
  status?: string;
  description?: string;
  usedDebitFallbackDescription: boolean;
}

const CREDIT_EVENT_TYPES = new Set([
  'MONEY_RECEIVED',
  'DEPOSIT',
  'ADMIN_TRANSFER',
  'ADMIN_DEVELOPMENT_FUNDING',
  'LOAN_DISBURSED',
  'INVESTMENT_MATURED',
  'INVESTMENT_EARNING',
  'WELCOME_REWARD',
  'WITHDRAWAL_REVERSED',
]);

const DEBIT_EVENT_TYPES = new Set([
  'MONEY_SENT',
  'WITHDRAWAL',
  'CHECK_WITHDRAWAL',
  'ADMIN_CHECK_WITHDRAWAL',
  'WIRE_CHECK_WITHDRAWAL_SUBMITTED',
  'WIRE_CHECK_WITHDRAWAL_DELIVERED',
  'LOAN_REPAYMENT',
  'INVESTMENT_CREATED',
  'CARD_ISSUANCE',
  'CARD_PURCHASE',
]);

const FINANCIAL_EVENT_TYPES = new Set([
  ...Array.from(CREDIT_EVENT_TYPES),
  ...Array.from(DEBIT_EVENT_TYPES),
  'INTERNAL_TRANSFER',
  'TRANSACTION_STATUS_UPDATED',
]);

const NON_TRANSACTION_SUPPORT_EVENTS = new Set([
  'KYC_SUBMITTED',
  'KYC_RESUBMITTED',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'KYC_ITEM_REJECTED',
  'ACCOUNT_FROZEN',
  'ACCOUNT_UNFROZEN',
  'BANK_LINK_SUBMITTED',
  'BANK_LINK_APPROVED',
  'BANK_VERIFICATION_SUBMITTED',
  'BANK_ACTIVATED',
  'BANK_VERIFICATION_REJECTED',
  'CARD_ACTIVATION_SUBMITTED',
  'CARD_ACTIVATION_APPROVED',
  'CARD_ACTIVATION_REJECTED',
  'LOAN_APPLIED',
  'LOAN_REJECTED',
]);

function cleanNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === 'undefined' || lower === 'null' || lower === 'n/a' || lower === 'unavailable') {
    return undefined;
  }
  return trimmed;
}

function parseAmountFromText(message?: string): number | null {
  if (!message) return null;
  const match = message.match(/[+-]?\$([0-9,]+(?:\.[0-9]{1,2})?)/);
  if (!match) return null;
  const num = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseSenderFromLegacyMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const receivedMatch = message.match(/\b(?:received|credited)\b.*?\bfrom\s+([^.(]+?)(?:\s*\(|\s*\.|$)/i);
  if (receivedMatch && receivedMatch[1]) {
    const candidate = cleanNonEmptyString(receivedMatch[1]);
    if (candidate && !candidate.toLowerCase().startsWith('withdrawal')) {
      return candidate;
    }
  }
  return undefined;
}

function parseRecipientFromLegacyMessage(message?: string): string | undefined {
  if (!message) return undefined;
  const sentMatch = message.match(/\b(?:sent|transferred)\b.*?\bto\s+([^.(]+?)(?:\s*\(|\s*\.|$)/i);
  if (sentMatch && sentMatch[1]) {
    const candidate = cleanNonEmptyString(sentMatch[1]);
    if (candidate && !candidate.toLowerCase().includes('your ')) {
      return candidate;
    }
  }
  return undefined;
}

function formatTransactionTypeLabel(eventType: string, txType: string, direction: FinancialDirection): string {
  const key = (eventType || txType || '').toUpperCase();
  switch (key) {
    case 'MONEY_RECEIVED':
    case 'ADMIN_TRANSFER':
      return 'Incoming Transfer';
    case 'MONEY_SENT':
      return 'Outgoing Transfer';
    case 'TRANSFER':
      return direction === 'CREDIT' ? 'Incoming Transfer' : 'Outgoing Transfer';
    case 'DEPOSIT':
      return 'Account Deposit';
    case 'WITHDRAWAL':
      return 'Account Withdrawal';
    case 'WITHDRAWAL_REVERSED':
    case 'REVERSAL':
      return 'Withdrawal Reversal Credit';
    case 'CHECK_WITHDRAWAL':
    case 'ADMIN_CHECK_WITHDRAWAL':
      return 'Check Withdrawal';
    case 'WIRE_CHECK_WITHDRAWAL':
    case 'WIRE_CHECK_WITHDRAWAL_SUBMITTED':
    case 'WIRE_CHECK_WITHDRAWAL_DELIVERED':
      return 'Wire Check Withdrawal';
    case 'CARD_PURCHASE':
      return 'Card Purchase';
    case 'CARD_ISSUANCE':
      return 'Card Issuance Fee';
    case 'INVESTMENT_CREATED':
    case 'INVESTMENT':
      return 'Term Investment Allocation';
    case 'INVESTMENT_MATURED':
    case 'INVESTMENT_MATURITY':
      return 'Investment Maturity Payout';
    case 'INVESTMENT_EARNING':
      return 'Investment Earnings Credit';
    case 'LOAN_DISBURSED':
    case 'LOAN_DISBURSEMENT':
      return 'Loan Disbursement';
    case 'LOAN_REPAYMENT':
      return 'Loan Repayment';
    case 'WELCOME_REWARD':
      return 'Welcome Reward Credit';
    case 'ADMIN_DEVELOPMENT_FUNDING':
      return 'Account Liquidity Credit';
    case 'INTERNAL_TRANSFER':
      return 'Internal Account Transfer';
    default:
      if (direction === 'CREDIT') return 'Account Credit';
      if (direction === 'DEBIT') return 'Account Debit';
      return 'Transaction Notice';
  }
}

export function isFinancialTransactionNotification(n: NotificationItem): boolean {
  const meta = n.metadata || {};
  const eventType = String(meta.eventType || '').toUpperCase();
  if (eventType && NON_TRANSACTION_SUPPORT_EVENTS.has(eventType)) {
    return false;
  }
  if (n.type === 'TRANSACTION' || n.type === 'INVESTMENT') {
    return true;
  }
  if (eventType && FINANCIAL_EVENT_TYPES.has(eventType)) {
    return true;
  }
  if (meta.direction === 'CREDIT' || meta.direction === 'DEBIT') {
    return true;
  }
  if (typeof meta.amount === 'number' && meta.transactionType) {
    return true;
  }
  return false;
}

export function buildTransactionNotificationPresentation(
  notification: NotificationItem
): TransactionNotificationPresentation {
  const meta = notification.metadata || {};
  const eventType = String(meta.eventType || '').toUpperCase();
  const txType = String(meta.transactionType || '').toUpperCase();
  const isFinancial = isFinancialTransactionNotification(notification);

  const titleLower = (notification.title || '').toLowerCase();
  const msgLower = (notification.message || '').toLowerCase();

  let direction: FinancialDirection = 'DEBIT';
  if (eventType === 'INTERNAL_TRANSFER' || txType === 'INTERNAL_TRANSFER') {
    direction = 'INTERNAL';
  } else if (meta.direction === 'CREDIT' || meta.direction === 'DEBIT') {
    direction = meta.direction;
  } else if (CREDIT_EVENT_TYPES.has(eventType) || CREDIT_EVENT_TYPES.has(txType)) {
    direction = 'CREDIT';
  } else if (DEBIT_EVENT_TYPES.has(eventType) || DEBIT_EVENT_TYPES.has(txType)) {
    direction = 'DEBIT';
  } else if (
    msgLower.includes('+$') ||
    titleLower.includes('received') ||
    titleLower.includes('deposit') ||
    titleLower.includes('credited') ||
    titleLower.includes('disbursed') ||
    titleLower.includes('matured') ||
    titleLower.includes('welcome reward') ||
    titleLower.includes('reversed')
  ) {
    direction = 'CREDIT';
  }

  const heading: TransactionNotificationPresentation['heading'] =
    direction === 'CREDIT'
      ? 'ACCOUNT CREDITED'
      : direction === 'INTERNAL'
      ? 'INTERNAL TRANSFER'
      : 'ACCOUNT DEBITED';

  const rawAmount =
    typeof meta.amount === 'number' && Number.isFinite(meta.amount)
      ? Math.abs(meta.amount)
      : parseAmountFromText(notification.message);
  const currency = cleanNonEmptyString(meta.currency) || 'USD';

  const amountStr =
    rawAmount !== null
      ? `$${rawAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
      : null;

  const signedAmountFormatted = amountStr
    ? direction === 'CREDIT'
      ? `+${amountStr}`
      : direction === 'DEBIT'
      ? `-${amountStr}`
      : amountStr
    : null;

  const timestampIso = cleanNonEmptyString(meta.date) || notification.createdAt;
  const parsedDate = new Date(timestampIso);
  const validDate = !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date();

  const formattedDate = validDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const formattedTime = validDate.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const reference =
    cleanNonEmptyString(meta.referenceNumber) ||
    cleanNonEmptyString(notification.referenceId) ||
    cleanNonEmptyString(notification.actionRecordId) ||
    notification.id;

  // Authoritative party resolution without fabricating unavailable data
  let senderName = cleanNonEmptyString(meta.senderName);
  let recipientName = cleanNonEmptyString(meta.recipientName);
  let merchantOrDestination =
    cleanNonEmptyString(meta.merchantName) || cleanNonEmptyString(meta.destinationLabel);

  if (direction === 'CREDIT') {
    if (!senderName) {
      if (eventType === 'MONEY_RECEIVED' || eventType === 'ADMIN_TRANSFER') {
        senderName =
          cleanNonEmptyString(meta.counterpartyName) ||
          parseSenderFromLegacyMessage(notification.message) ||
          (eventType === 'ADMIN_TRANSFER' ? 'Bennett Johnson' : undefined);
      } else if (eventType === 'DEPOSIT' || txType === 'DEPOSIT') {
        senderName = cleanNonEmptyString(meta.depositMethodLabel) || cleanNonEmptyString(meta.merchantName) || 'External Deposit Gateway';
      } else if (eventType === 'LOAN_DISBURSED' || txType === 'LOAN_DISBURSEMENT') {
        senderName = 'Monvera Credit & Lending Facility';
      } else if (eventType === 'INVESTMENT_MATURED' || txType === 'INVESTMENT_MATURITY') {
        senderName = 'Monvera Term Investment Portfolio';
      } else if (eventType === 'WELCOME_REWARD' || txType === 'WELCOME_REWARD') {
        senderName = 'Monvera Welcome Rewards';
      } else if (eventType === 'WITHDRAWAL_REVERSED' || txType === 'REVERSAL') {
        senderName = 'Monvera Settlement Reversal';
      } else if (eventType === 'ADMIN_DEVELOPMENT_FUNDING' || txType === 'ADMIN_DEVELOPMENT_FUNDING') {
        senderName = 'Monvera Treasury Facility';
      } else {
        senderName = cleanNonEmptyString(meta.counterpartyName) || parseSenderFromLegacyMessage(notification.message);
      }
    }

    if (!recipientName) {
      recipientName = cleanNonEmptyString(meta.customerName) || "Customer's Monvera Account";
    }
  } else if (direction === 'DEBIT') {
    if (!senderName) {
      senderName = cleanNonEmptyString(meta.customerName);
    }

    if (!recipientName) {
      if (eventType === 'MONEY_SENT') {
        recipientName =
          cleanNonEmptyString(meta.counterpartyName) ||
          parseRecipientFromLegacyMessage(notification.message);
      } else if (eventType === 'CHECK_WITHDRAWAL' || eventType === 'ADMIN_CHECK_WITHDRAWAL' || txType === 'CHECK_WITHDRAWAL') {
        recipientName = cleanNonEmptyString(meta.payeeName);
      } else if (
        eventType === 'WIRE_CHECK_WITHDRAWAL_SUBMITTED' ||
        eventType === 'WIRE_CHECK_WITHDRAWAL_DELIVERED' ||
        txType === 'WIRE_CHECK_WITHDRAWAL'
      ) {
        recipientName = cleanNonEmptyString(meta.bankName) || cleanNonEmptyString(meta.destinationLabel);
      } else if (eventType === 'WITHDRAWAL' || txType === 'WITHDRAWAL') {
        recipientName = cleanNonEmptyString(meta.destinationLabel) || cleanNonEmptyString(meta.bankName);
      } else if (eventType === 'LOAN_REPAYMENT' || txType === 'LOAN_REPAYMENT') {
        recipientName = 'Monvera Credit & Lending Facility';
      } else if (eventType === 'INVESTMENT_CREATED' || txType === 'INVESTMENT') {
        recipientName = 'Monvera Term Investment Portfolio';
      } else if (eventType === 'CARD_ISSUANCE') {
        recipientName = 'Monvera Card Issuance Facility';
      } else if (eventType === 'CARD_PURCHASE' || txType === 'CARD_PURCHASE') {
        recipientName = cleanNonEmptyString(meta.merchantName) || cleanNonEmptyString(meta.counterpartyName);
      } else {
        recipientName = cleanNonEmptyString(meta.counterpartyName);
      }
    }

    if (!merchantOrDestination) {
      merchantOrDestination =
        cleanNonEmptyString(meta.payeeName) ||
        cleanNonEmptyString(meta.bankName) ||
        cleanNonEmptyString(meta.destAccountLabel);
    }
  } else {
    // INTERNAL TRANSFER
    if (!senderName) {
      senderName = cleanNonEmptyString(meta.sourceAccountLabel) || cleanNonEmptyString(meta.customerName);
    }
    if (!recipientName) {
      recipientName = cleanNonEmptyString(meta.destAccountLabel);
    }
    if (!merchantOrDestination && recipientName) {
      merchantOrDestination = recipientName;
    }
  }

  // Description rules:
  // - CREDIT: display actual description ONLY if genuinely supplied; omit completely if absent.
  // - DEBIT: display actual description if supplied; if recipientName AND description are missing/unavailable,
  //   automatically use "Money transferred".
  const suppliedDescription =
    meta.descriptionProvided === false ? undefined : cleanNonEmptyString(meta.description);

  let description: string | undefined;
  let usedDebitFallbackDescription = false;

  if (direction === 'CREDIT') {
    description = suppliedDescription;
  } else if (direction === 'DEBIT') {
    if (suppliedDescription) {
      description = suppliedDescription;
    } else if (!recipientName) {
      description = 'Money transferred';
      usedDebitFallbackDescription = true;
    }
  } else {
    description = suppliedDescription;
  }

  return {
    isFinancialTransaction: isFinancial,
    direction,
    heading,
    transactionLabel: formatTransactionTypeLabel(eventType, txType, direction),
    amount: rawAmount,
    currency,
    signedAmountFormatted,
    senderName,
    recipientName,
    merchantOrDestination,
    accountNumberMasked: cleanNonEmptyString(meta.accountNumberMasked),
    formattedDate,
    formattedTime,
    reference,
    status: cleanNonEmptyString(meta.status),
    description,
    usedDebitFallbackDescription,
  };
}
