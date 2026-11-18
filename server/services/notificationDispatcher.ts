// Monvera Digital Banking — Server-Side Multi-Channel Notification Dispatcher
// Uses Firebase Admin Messaging (FCM HTTP v1), persistent Firestore idempotency leases,
// strict customer-device isolation, preference enforcement, SMS, and Email dispatch.

import crypto from 'crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { Messaging } from 'firebase-admin/messaging';
import {
  adminFirestore,
  adminMessaging,
  isFirebaseAdminConfigured,
  isFirebaseMessagingConfigured,
} from '../firebaseAdmin';
import { smsService, SmsDispatchResult } from './smsService';
import { emailService, EmailDispatchResult } from './emailService';
import { persistCustomerNotification, maskAccountNumber } from './notificationStore';
import type { BalanceMetrics, Transaction } from '../../src/types';

export type NotificationCategory = 'TRANSACTION' | 'SECURITY' | 'INVESTMENT' | 'SYSTEM' | 'SUPPORT';
export type DispatchEventType = 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY' | 'TRANSACTION' | 'INVESTMENT' | 'SYSTEM' | 'SUPPORT';
export type TransactionNotificationLifecycleStage = 'INITIATED' | 'REVERSED' | 'SUBMITTED' | 'DELIVERED';

/**
 * Deterministic lifecycle event-key contract for future multi-stage transaction notification integration.
 * Preserves underlying ledger transaction IDs while separating distinct notification milestones
 * (e.g., `${transactionId}:INITIATED`, `${transactionId}:REVERSED`, `${transactionId}:SUBMITTED`, `${transactionId}:DELIVERED`).
 * Per-user dispatch isolation remains enforced by `computeDispatchLogId(userId, eventKey)`.
 */
export function buildTransactionLifecycleEventKey(
  transactionId: string,
  stage: TransactionNotificationLifecycleStage
): string {
  const cleanTxId = String(transactionId || '').trim();
  if (!cleanTxId) {
    throw new Error('transactionId is required to build a transaction lifecycle event key.');
  }
  return `${cleanTxId}:${stage}`;
}

function resolveAuthoritativeAccountMasked(
  metrics: BalanceMetrics | undefined,
  preferredType: string | undefined,
  fallbackAccountNumber: string | undefined,
  fallbackLabel?: string
): string {
  const normalizedPreferred = String(preferredType || '').trim().toUpperCase();
  const accountsList = Array.isArray(metrics?.accounts) ? metrics.accounts : [];
  const matchedAccount =
    accountsList.find((a) => normalizedPreferred && String(a?.type || '').trim().toUpperCase() === normalizedPreferred) ||
    accountsList.find((a) => fallbackAccountNumber && a?.accountNumber === fallbackAccountNumber);

  const accountNumber = String(fallbackAccountNumber || matchedAccount?.accountNumber || '').trim();
  const maskedNumber = accountNumber ? maskAccountNumber(accountNumber) : '';
  const accountLabel =
    String(matchedAccount?.nickname || fallbackLabel || '').trim() ||
    (matchedAccount?.type === 'SAVINGS'
      ? 'Monvera High-Yield Treasury'
      : matchedAccount?.type === 'CHECKING'
        ? 'Monvera Premier Checking'
        : '');

  if (accountLabel && maskedNumber) {
    return `${accountLabel} (${maskedNumber})`;
  }
  if (maskedNumber) {
    return maskedNumber;
  }
  if (accountLabel) {
    return accountLabel;
  }
  return 'Monvera Account';
}

export interface BuildTransferDispatchOptions {
  mode: 'MONVERA_C2C' | 'ADMIN_TRANSFER';
  authenticatedSenderUid?: string;
  senderMetrics?: BalanceMetrics;
  recipientMetrics?: BalanceMetrics;
  senderContact?: { email?: string; phone?: string };
  recipientContact?: { email?: string; phone?: string };
}

/**
 * Constructs notification dispatch events strictly from a committed authoritative transaction.
 * Rejects duplicate replays, non-COMPLETED transactions, and invalid/missing amounts.
 */
export function buildTrustedTransferDispatchEvents(
  tx: Transaction | null | undefined,
  isDuplicate: boolean | undefined,
  options: BuildTransferDispatchOptions
): DispatchNotificationEvent[] {
  if (isDuplicate === true) return [];
  if (!tx || tx.status !== 'COMPLETED') return [];

  const committedAmount = Number(tx.amount);
  if (!Number.isFinite(committedAmount) || committedAmount <= 0) return [];

  const transactionId = String(tx.id || '').trim();
  if (!transactionId) return [];
  const referenceNumber = String(tx.referenceNumber || transactionId).trim();
  const currency = String(tx.currency || 'USD').trim() || 'USD';

  const events: DispatchNotificationEvent[] = [];

  const recipientUid = String(tx.recipientUserId || '').trim();
  const recipientName = String(tx.recipientName || '').trim() || 'Monvera Member';
  const defaultSenderName =
    options.mode === 'ADMIN_TRANSFER'
      ? String(tx.metadata?.adminSenderName || 'Bennett Johnson').trim()
      : 'Monvera Member';
  const senderName = String(tx.senderName || '').trim() || defaultSenderName;

  if (recipientUid) {
    const recipientAccountLabel = resolveAuthoritativeAccountMasked(
      options.recipientMetrics,
      tx.metadata?.recipientAccountType || 'CHECKING',
      tx.recipientAccountNumber || tx.metadata?.recipientAccountNumber,
      tx.metadata?.destinationAccount
    );

    events.push({
      transactionId,
      referenceNumber,
      type: 'MONEY_RECEIVED',
      userId: recipientUid,
      recipientName,
      recipientEmail: options.recipientContact?.email,
      recipientPhone: options.recipientContact?.phone,
      amount: committedAmount,
      currency,
      senderName,
      accountMasked: recipientAccountLabel,
    });
  }

  if (options.mode === 'MONVERA_C2C') {
    const committedSenderUid = String(tx.senderUserId || '').trim();
    if (
      committedSenderUid &&
      (!options.authenticatedSenderUid || committedSenderUid === options.authenticatedSenderUid)
    ) {
      const senderAccountLabel = resolveAuthoritativeAccountMasked(
        options.senderMetrics,
        tx.metadata?.sourceAccountType || 'CHECKING',
        tx.senderAccountNumber
      );

      events.push({
        transactionId,
        referenceNumber,
        type: 'MONEY_SENT',
        userId: committedSenderUid,
        recipientName,
        recipientEmail: options.senderContact?.email,
        recipientPhone: options.senderContact?.phone,
        amount: committedAmount,
        currency,
        senderName,
        accountMasked: senderAccountLabel,
      });
    }
  }

  return events;
}

export interface DispatchNotificationPreferences {
  pushEnabled?: boolean;
  smsEnabled?: boolean;
  emailEnabled?: boolean;
  transactionAlerts?: boolean;
  securityAlerts?: boolean;
}

export interface DispatchNotificationEvent {
  transactionId: string;
  referenceNumber: string;
  eventKey?: string;
  lifecycleStage?: TransactionNotificationLifecycleStage;
  type: DispatchEventType;
  category?: NotificationCategory;
  userId: string;
  title?: string;
  body?: string;
  actionUrl?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  amount?: number;
  currency?: string;
  senderName?: string;
  accountMasked?: string;
  preferences?: DispatchNotificationPreferences;
  pushTokens?: string[];
}

export interface PushDispatchSummary {
  attempted: boolean;
  delivered: boolean;
  status: string;
  targetedDevices?: number;
  deliveredDevices?: number;
  failedDevices?: number;
  removedInvalidTokens?: number;
}

export interface DispatchResultSummary {
  transactionId: string;
  referenceNumber: string;
  push: PushDispatchSummary;
  sms: SmsDispatchResult;
  email: EmailDispatchResult;
}

export interface OutboxDispatchOwnershipContext {
  outboxId: string;
  leaseToken: string;
  outboxCollection?: string;
  channels?: {
    push?: boolean;
    sms?: boolean;
    email?: boolean;
  };
  knownChannelStatuses?: {
    pushStatus?: string;
    smsStatus?: string;
    emailStatus?: string;
  };
  requirePersistentTracking?: boolean;
  nowMs?: number;
}

export interface DispatchExecutionOptions {
  outboxContext?: OutboxDispatchOwnershipContext;
  channels?: {
    push?: boolean;
    sms?: boolean;
    email?: boolean;
  };
  knownChannelStatuses?: {
    pushStatus?: string;
    smsStatus?: string;
    emailStatus?: string;
  };
  requirePersistentTracking?: boolean;
}

export interface StoredDeviceToken {
  docId: string;
  tokenId: string;
  token: string;
  userId: string;
}

export interface RegisterTokenInput {
  uid: string;
  token: string;
  platform?: string;
  userAgent?: string;
}

export interface RegisterTokenResult {
  success: boolean;
  tokenId?: string;
  reassignedFromPreviousUser?: boolean;
  error?: string;
}

export interface UnregisterTokenInput {
  uid: string;
  token: string;
}

export interface UnregisterTokenResult {
  success: boolean;
  unregistered: boolean;
  error?: string;
}

export interface DispatcherDependencies {
  firestore?: Firestore;
  messaging?: Messaging;
  isAdminConfigured?: () => boolean;
  isMessagingConfigured?: () => boolean;
  persistNotification?: typeof persistCustomerNotification;
  leaseDurationMs?: number;
  instanceId?: string;
}

const FCM_MULTICAST_BATCH_SIZE = 500;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const MAX_IN_MEMORY_DEDUPE_ENTRIES = 5000;
const PERMANENT_INVALID_TOKEN_CODES = new Set<string>([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);
const CREDENTIAL_MISMATCH_ERROR_CODE = 'messaging/mismatched-credential';

/**
 * Validates that an FCM device registration token is well-formed and bounded.
 */
export function validatePushToken(rawToken: unknown): { valid: boolean; token?: string; error?: string } {
  if (typeof rawToken !== 'string') {
    return { valid: false, error: 'FCM registration token must be a string.' };
  }
  const token = rawToken.trim();
  if (token.length < 20 || token.length > 4096) {
    return { valid: false, error: 'FCM registration token length is invalid.' };
  }
  if (/[\s\x00-\x1f\x7f]/.test(token)) {
    return { valid: false, error: 'FCM registration token contains invalid whitespace or control characters.' };
  }
  return { valid: true, token };
}

/**
 * Collision-free deterministic Firestore document ID derived from the full FCM token.
 */
export function computePushTokenId(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

/**
 * Legacy client-derived document ID (last 32 chars base64), preserved strictly for cleanup
 * during migration or unregistration so stale duplicate documents never linger.
 */
export function computeLegacyPushTokenId(token: string): string {
  return Buffer.from(token.slice(-32), 'utf8').toString('base64').replace(/[/+=]/g, '_');
}

export function computeDispatchLogId(userId: string, eventKey: string): string {
  return crypto.createHash('sha256').update(`${userId}::${eventKey}`).digest('base64url');
}

/**
 * Derives the dispatch dedupe/log key for an event.
 * Uses explicit `event.eventKey` when supplied while preserving existing
 * `${transactionId || referenceNumber}_${type}` keys for backward compatibility.
 */
export function resolveDispatchKey(event: Pick<DispatchNotificationEvent, 'transactionId' | 'referenceNumber' | 'eventKey' | 'type'>): string {
  const explicit = typeof event.eventKey === 'string' ? event.eventKey.trim() : '';
  const base = explicit || String(event.transactionId || event.referenceNumber || '').trim();
  return `${base}_${event.type}`;
}

function sanitizeActionUrl(url?: string): string {
  if (typeof url !== 'string') return '/dashboard';
  const trimmed = url.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/dashboard';
  }
  return trimmed.slice(0, 200);
}

function sanitizeAccountLabel(accountMasked?: string): string {
  if (!accountMasked || typeof accountMasked !== 'string') return 'Monvera Account';
  const cleaned = accountMasked.trim();
  // Never expose full 10+ digit account numbers in external push payloads
  if (/\d{6,}/.test(cleaned)) {
    const digits = cleaned.replace(/\D/g, '');
    return `Monvera •••• ${digits.slice(-4)}`;
  }
  return cleaned.slice(0, 60);
}

function resolveNotificationCategory(event: DispatchNotificationEvent): NotificationCategory {
  if (event.category) return event.category;
  if (event.type === 'SECURITY') return 'SECURITY';
  if (event.type === 'INVESTMENT') return 'INVESTMENT';
  if (event.type === 'SYSTEM') return 'SYSTEM';
  if (event.type === 'SUPPORT') return 'SUPPORT';
  return 'TRANSACTION';
}

function formatSafePushContent(event: DispatchNotificationEvent): {
  title: string;
  body: string;
  url: string;
  category: NotificationCategory;
  safeRef: string;
} {
  const category = resolveNotificationCategory(event);
  const safeRef = String(event.referenceNumber || event.transactionId || 'MV-ALERT').slice(0, 64);
  const url = sanitizeActionUrl(event.actionUrl);
  const accountLabel = sanitizeAccountLabel(event.accountMasked);

  if (event.title && event.body) {
    return {
      title: String(event.title).trim().slice(0, 120),
      body: String(event.body).trim().slice(0, 320),
      url,
      category,
      safeRef,
    };
  }

  const formattedAmt =
    typeof event.amount === 'number' && Number.isFinite(event.amount)
      ? `$${event.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '';

  if (event.type === 'MONEY_RECEIVED') {
    const sender = (event.senderName || 'Monvera Member').trim().slice(0, 60);
    return {
      title: 'Money Received — Monvera',
      body: formattedAmt
        ? `You received ${formattedAmt} from ${sender} (${accountLabel}). Ref: ${safeRef}.`
        : `You received a deposit into ${accountLabel}. Ref: ${safeRef}.`,
      url,
      category,
      safeRef,
    };
  }

  if (event.type === 'MONEY_SENT') {
    const recipient = (event.recipientName || 'Recipient').trim().slice(0, 60);
    return {
      title: 'Transfer Sent — Monvera',
      body: formattedAmt
        ? `You sent ${formattedAmt} to ${recipient} from ${accountLabel}. Ref: ${safeRef}.`
        : `Your transfer from ${accountLabel} was processed. Ref: ${safeRef}.`,
      url,
      category,
      safeRef,
    };
  }

  if (category === 'SECURITY') {
    return {
      title: 'Security Alert — Monvera',
      body: `Important security update on your Monvera profile. Ref: ${safeRef}.`,
      url,
      category,
      safeRef,
    };
  }

  if (category === 'INVESTMENT') {
    return {
      title: 'Investment Update — Monvera',
      body: formattedAmt
        ? `Investment activity of ${formattedAmt} recorded. Ref: ${safeRef}.`
        : `An update occurred on your Monvera investment portfolio. Ref: ${safeRef}.`,
      url,
      category,
      safeRef,
    };
  }

  return {
    title: 'Account Alert — Monvera',
    body: formattedAmt
      ? `Account activity of ${formattedAmt} on ${accountLabel}. Ref: ${safeRef}.`
      : `New activity recorded on ${accountLabel}. Ref: ${safeRef}.`,
    url,
    category,
    safeRef,
  };
}

/**
 * Registers or atomically reassigns an FCM device token exclusively to the verified `uid`.
 * Removes stale ownership from any previous user on a shared device WITHOUT touching other devices.
 */
export async function registerCustomerPushToken(
  input: RegisterTokenInput,
  firestoreOverride?: Firestore
): Promise<RegisterTokenResult> {
  const uid = String(input.uid || '').trim();
  if (!uid) {
    return { success: false, error: 'Authenticated user UID is required.' };
  }

  const tokenCheck = validatePushToken(input.token);
  if (!tokenCheck.valid || !tokenCheck.token) {
    return { success: false, error: tokenCheck.error || 'Invalid FCM registration token.' };
  }

  const token = tokenCheck.token;
  const fs = firestoreOverride || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!fs) {
    return { success: false, error: 'Firebase Admin Firestore is unavailable.' };
  }

  const tokenId = computePushTokenId(token);
  const legacyTokenId = computeLegacyPushTokenId(token);
  const hasLegacyAlias = legacyTokenId !== tokenId;

  const safePlatform = typeof input.platform === 'string' && input.platform.trim() ? input.platform.trim().slice(0, 32) : 'web';
  const safeUserAgent = typeof input.userAgent === 'string' ? input.userAgent.trim().slice(0, 512) : 'unknown';
  const nowIso = new Date().toISOString();

  let reassignedFromPreviousUser = false;

  await fs.runTransaction(async (tx) => {
    const globalRef = fs.collection('notification_tokens').doc(tokenId);
    const userTokenRef = fs.collection('users').doc(uid).collection('notificationTokens').doc(tokenId);
    const legacyGlobalRef = hasLegacyAlias ? fs.collection('notification_tokens').doc(legacyTokenId) : null;
    const legacyUserTokenRef = hasLegacyAlias ? fs.collection('users').doc(uid).collection('notificationTokens').doc(legacyTokenId) : null;

    // 1. Perform all transaction reads first
    const globalSnap = await tx.get(globalRef);
    const userSnap = await tx.get(userTokenRef);
    const legacyGlobalSnap = legacyGlobalRef ? await tx.get(legacyGlobalRef) : null;

    // 2. Clean up previous user's link for ONLY this device token if shared device switched accounts
    const previousOwnerUid = globalSnap.exists ? String(globalSnap.data()?.userId || '').trim() : '';
    if (previousOwnerUid && previousOwnerUid !== uid) {
      reassignedFromPreviousUser = true;
      const prevOwnerTokenRef = fs.collection('users').doc(previousOwnerUid).collection('notificationTokens').doc(tokenId);
      tx.delete(prevOwnerTokenRef);
    }

    if (legacyGlobalSnap?.exists) {
      const legacyOwnerUid = String(legacyGlobalSnap.data()?.userId || '').trim();
      if (legacyOwnerUid) {
        if (legacyOwnerUid !== uid) {
          reassignedFromPreviousUser = true;
        }
        tx.delete(fs.collection('users').doc(legacyOwnerUid).collection('notificationTokens').doc(legacyTokenId));
      }
      if (legacyGlobalRef) {
        tx.delete(legacyGlobalRef);
      }
    }
    if (legacyUserTokenRef) {
      tx.delete(legacyUserTokenRef);
    }

    const existingCreatedAt = userSnap.exists ? (userSnap.data()?.createdAt as string | undefined) : undefined;
    const record = {
      id: tokenId,
      userId: uid,
      token,
      platform: safePlatform,
      userAgent: safeUserAgent,
      createdAt: existingCreatedAt || nowIso,
      lastUsedAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(userTokenRef, record, { merge: true });
    tx.set(globalRef, record, { merge: true });
  });

  return {
    success: true,
    tokenId,
    reassignedFromPreviousUser,
  };
}

/**
 * Unlinks ONLY the specified device token for the verified `uid`.
 * Never removes other valid devices belonging to `uid`, and never deletes a global index entry
 * if it has already been reassigned to another customer.
 */
export async function unregisterCustomerPushToken(
  input: UnregisterTokenInput,
  firestoreOverride?: Firestore
): Promise<UnregisterTokenResult> {
  const uid = String(input.uid || '').trim();
  if (!uid) {
    return { success: false, unregistered: false, error: 'Authenticated user UID is required.' };
  }

  const tokenCheck = validatePushToken(input.token);
  if (!tokenCheck.valid || !tokenCheck.token) {
    return { success: false, unregistered: false, error: tokenCheck.error || 'Invalid FCM registration token.' };
  }

  const token = tokenCheck.token;
  const fs = firestoreOverride || (isFirebaseAdminConfigured() ? adminFirestore : null);
  if (!fs) {
    return { success: false, unregistered: false, error: 'Firebase Admin Firestore is unavailable.' };
  }

  const tokenId = computePushTokenId(token);
  const legacyTokenId = computeLegacyPushTokenId(token);
  const hasLegacyAlias = legacyTokenId !== tokenId;

  let removedAny = false;

  await fs.runTransaction(async (tx) => {
    const globalRef = fs.collection('notification_tokens').doc(tokenId);
    const userTokenRef = fs.collection('users').doc(uid).collection('notificationTokens').doc(tokenId);
    const legacyGlobalRef = hasLegacyAlias ? fs.collection('notification_tokens').doc(legacyTokenId) : null;
    const legacyUserTokenRef = hasLegacyAlias ? fs.collection('users').doc(uid).collection('notificationTokens').doc(legacyTokenId) : null;

    const globalSnap = await tx.get(globalRef);
    const userSnap = await tx.get(userTokenRef);
    const legacyGlobalSnap = legacyGlobalRef ? await tx.get(legacyGlobalRef) : null;
    const legacyUserSnap = legacyUserTokenRef ? await tx.get(legacyUserTokenRef) : null;

    if (userSnap.exists) {
      tx.delete(userTokenRef);
      removedAny = true;
    }
    if (legacyUserTokenRef && legacyUserSnap?.exists) {
      tx.delete(legacyUserTokenRef);
      removedAny = true;
    }

    if (globalSnap.exists && globalSnap.data()?.userId === uid) {
      tx.delete(globalRef);
      removedAny = true;
    }
    if (legacyGlobalRef && legacyGlobalSnap?.exists && legacyGlobalSnap.data()?.userId === uid) {
      tx.delete(legacyGlobalRef);
      removedAny = true;
    }
  });

  return { success: true, unregistered: removedAny };
}

export class ServerNotificationDispatcher {
  private processedEvents = new Set<string>();
  private deps: DispatcherDependencies;
  private instanceId: string;

  constructor(deps: DispatcherDependencies = {}) {
    this.deps = deps;
    this.instanceId = deps.instanceId || `srv_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private getFirestore(): Firestore | null {
    if (this.deps.firestore) return this.deps.firestore;
    const configured = this.deps.isAdminConfigured ? this.deps.isAdminConfigured() : isFirebaseAdminConfigured();
    return configured ? adminFirestore : null;
  }

  private getMessaging(): Messaging | null {
    if (this.deps.messaging) return this.deps.messaging;
    const configured = this.deps.isMessagingConfigured ? this.deps.isMessagingConfigured() : isFirebaseMessagingConfigured();
    return configured ? adminMessaging : null;
  }

  private rememberInMemory(key: string): void {
    if (this.processedEvents.size >= MAX_IN_MEMORY_DEDUPE_ENTRIES) {
      const oldest = this.processedEvents.values().next().value;
      if (oldest) this.processedEvents.delete(oldest);
    }
    this.processedEvents.add(key);
  }

  /**
   * Load customer notification preferences from Firestore:
   * users/{uid}/notificationPreferences/settings -> fallback notification_preferences/{uid}
   */
  public async loadCustomerPreferences(userId: string): Promise<Required<DispatchNotificationPreferences>> {
    const defaults: Required<DispatchNotificationPreferences> = {
      pushEnabled: true,
      smsEnabled: true,
      emailEnabled: true,
      transactionAlerts: true,
      securityAlerts: true,
    };

    const fs = this.getFirestore();
    if (!fs || !userId) return defaults;

    try {
      const settingsSnap = await fs
        .collection('users')
        .doc(userId)
        .collection('notificationPreferences')
        .doc('settings')
        .get();

      if (settingsSnap.exists) {
        const d = settingsSnap.data() || {};
        return {
          pushEnabled: d.pushEnabled !== false,
          smsEnabled: d.smsEnabled !== false,
          emailEnabled: d.emailEnabled !== false,
          transactionAlerts: d.transactionAlerts !== false,
          securityAlerts: true,
        };
      }

      const rootSnap = await fs.collection('notification_preferences').doc(userId).get();
      if (rootSnap.exists) {
        const d = rootSnap.data() || {};
        return {
          pushEnabled: d.pushEnabled !== false,
          smsEnabled: d.smsEnabled !== false,
          emailEnabled: d.emailEnabled !== false,
          transactionAlerts: d.transactionAlerts !== false,
          securityAlerts: true,
        };
      }
    } catch (err: any) {
      console.warn('[Notification Dispatcher] Preference lookup note:', err?.message || err);
    }

    return defaults;
  }

  /**
   * Read the authoritative outbox record and verify active lease ownership.
   * Returns { leaseValid: true } for non-outbox legacy callers.
   */
  private async readOutboxRecordSnapshot(
    fs: Firestore | null,
    outboxCtx?: OutboxDispatchOwnershipContext
  ): Promise<{ leaseValid: boolean; outboxData?: Record<string, any> }> {
    if (!outboxCtx) {
      return { leaseValid: true };
    }
    if (!fs || !outboxCtx.outboxId || !outboxCtx.leaseToken) {
      return { leaseValid: false };
    }

    const colName = outboxCtx.outboxCollection || 'notification_outbox';
    const snap = await fs.collection(colName).doc(outboxCtx.outboxId).get();
    if (!snap.exists) {
      return { leaseValid: false };
    }

    const data = snap.data() || {};
    if (
      data.status !== 'PROCESSING' ||
      !data.leaseToken ||
      data.leaseToken !== outboxCtx.leaseToken
    ) {
      return { leaseValid: false, outboxData: data };
    }

    const effectiveNowMs = outboxCtx.nowMs ?? Date.now();
    if (data.leaseExpiresAt) {
      const expMs = Date.parse(String(data.leaseExpiresAt));
      if (Number.isFinite(expMs) && expMs <= effectiveNowMs) {
        return { leaseValid: false, outboxData: data };
      }
    }

    return { leaseValid: true, outboxData: data };
  }

  /**
   * Persist independent per-channel completion state in `notification_dispatch_logs/{docId}`
   * without downgrading any channel already confirmed SENT or NO_ACTIVE_TOKENS.
   * When an outboxContext is supplied, atomically verifies active outbox lease ownership
   * inside the transaction before writing.
   */
  private async persistChannelOutcomes(
    fs: Firestore | null,
    event: DispatchNotificationEvent,
    category: NotificationCategory,
    dispatchKey: string,
    updates: {
      pushStatus?: string;
      smsStatus?: string;
      emailStatus?: string;
      smsError?: string;
      emailError?: string;
    },
    options?: {
      outboxContext?: OutboxDispatchOwnershipContext;
      requirePersistentTracking?: boolean;
    }
  ): Promise<{ persisted: boolean; leaseLost: boolean }> {
    const requireTracking = Boolean(options?.requirePersistentTracking ?? options?.outboxContext);
    if (!fs) {
      if (requireTracking) {
        throw new Error('PERSISTENCE_ERROR: Firestore unavailable for required channel completion tracking.');
      }
      return { persisted: false, leaseLost: false };
    }

    const docId = computeDispatchLogId(event.userId, dispatchKey);
    const logRef = fs.collection('notification_dispatch_logs').doc(docId);
    const outboxCtx = options?.outboxContext;
    const outboxRef = outboxCtx
      ? fs.collection(outboxCtx.outboxCollection || 'notification_outbox').doc(outboxCtx.outboxId)
      : null;
    const nowIso = new Date().toISOString();

    try {
      const outcome = await fs.runTransaction(async (tx) => {
        // ALL READS MUST PRECEDE ALL WRITES
        const [snap, outboxSnap] = await Promise.all([
          tx.get(logRef),
          outboxRef ? tx.get(outboxRef) : Promise.resolve(null),
        ]);

        if (outboxCtx) {
          if (!outboxSnap?.exists) {
            return { persisted: false, leaseLost: true };
          }
          const outboxData = outboxSnap.data() || {};
          if (
            outboxData.status !== 'PROCESSING' ||
            !outboxData.leaseToken ||
            outboxData.leaseToken !== outboxCtx.leaseToken
          ) {
            return { persisted: false, leaseLost: true };
          }
          const effectiveNowMs = outboxCtx.nowMs ?? Date.now();
          if (outboxData.leaseExpiresAt) {
            const expMs = Date.parse(String(outboxData.leaseExpiresAt));
            if (Number.isFinite(expMs) && expMs <= effectiveNowMs) {
              return { persisted: false, leaseLost: true };
            }
          }
        }

        const existing = snap.exists ? snap.data() || {} : {};
        const patch: Record<string, any> = {
          dispatchKey,
          userId: event.userId,
          transactionId: event.transactionId || event.referenceNumber,
          referenceNumber: event.referenceNumber,
          category,
          updatedAt: nowIso,
        };
        if (event.eventKey) {
          patch.eventKey = event.eventKey;
        }
        if (event.lifecycleStage) {
          patch.lifecycleStage = event.lifecycleStage;
        }
        if (!snap.exists) {
          patch.createdAt = nowIso;
        }

        if (updates.pushStatus && existing.pushStatus !== 'SENT' && existing.pushStatus !== 'NO_ACTIVE_TOKENS') {
          patch.pushStatus = updates.pushStatus;
        }

        if (updates.smsStatus && existing.smsStatus !== 'SENT') {
          patch.smsStatus = updates.smsStatus;
          if (updates.smsStatus === 'SENT') {
            patch.smsSentAt = nowIso;
          }
          if (updates.smsError) {
            patch.smsLastError = updates.smsError;
          }
        }

        if (updates.emailStatus && existing.emailStatus !== 'SENT') {
          patch.emailStatus = updates.emailStatus;
          if (updates.emailStatus === 'SENT') {
            patch.emailSentAt = nowIso;
          }
          if (updates.emailError) {
            patch.emailLastError = updates.emailError;
          }
        }

        tx.set(logRef, patch, { merge: true });
        return { persisted: true, leaseLost: false };
      });
      return outcome;
    } catch (err) {
      if (requireTracking) {
        throw err;
      }
      // Non-blocking audit/channel persistence for legacy callers
      return { persisted: false, leaseLost: false };
    }
  }

  private buildLeaseLostSummary(
    event: DispatchNotificationEvent,
    pushOverride?: PushDispatchSummary
  ): DispatchResultSummary {
    return {
      transactionId: event.transactionId,
      referenceNumber: event.referenceNumber,
      push: pushOverride || { attempted: false, delivered: false, status: 'LEASE_LOST' },
      sms: { success: false, delivered: false, status: 'LEASE_LOST', error: 'ABORTED_LEASE_LOST' },
      email: { success: false, delivered: false, status: 'LEASE_LOST', error: 'ABORTED_LEASE_LOST' },
    };
  }

  /**
   * Dispatch multi-channel notifications in background or under durable outbox ownership.
   */
  public async dispatch(
    event: DispatchNotificationEvent,
    options?: DispatchExecutionOptions
  ): Promise<DispatchResultSummary> {
    const category = resolveNotificationCategory(event);
    const dispatchKey = resolveDispatchKey(event);
    const inMemEventKey = `${event.userId}_${dispatchKey}`;
    const smsMemKey = `${inMemEventKey}::SMS`;
    const emailMemKey = `${inMemEventKey}::EMAIL`;
    const fs = this.getFirestore();

    const outboxCtx = options?.outboxContext;
    const isOutboxOwned = Boolean(outboxCtx);
    const requirePersistentTracking = Boolean(
      options?.requirePersistentTracking ?? outboxCtx?.requirePersistentTracking ?? isOutboxOwned
    );
    const channelSelection = options?.channels ?? outboxCtx?.channels;
    const callerKnownStatuses = options?.knownChannelStatuses ?? outboxCtx?.knownChannelStatuses;

    // 0. For outbox-owned dispatch, verify active lease ownership BEFORE touching any channel
    let liveOutboxData: Record<string, any> | undefined;
    if (outboxCtx) {
      const initialLease = await this.readOutboxRecordSnapshot(fs, outboxCtx);
      if (!initialLease.leaseValid) {
        return this.buildLeaseLostSummary(event);
      }
      liveOutboxData = initialLease.outboxData;
    }

    // Load authoritative customer preferences from Firestore (allowing explicit internal overrides if supplied)
    const firestorePrefs = await this.loadCustomerPreferences(event.userId);
    const prefs: Required<DispatchNotificationPreferences> = {
      ...firestorePrefs,
      ...(event.preferences || {}),
      securityAlerts: true,
    };

    // Read persistent channel completion state before sending so retries only run unfinished channels
    let persistedLog: Record<string, any> | null = null;
    if (fs) {
      try {
        const logId = computeDispatchLogId(event.userId, dispatchKey);
        const logSnap = await fs.collection('notification_dispatch_logs').doc(logId).get();
        if (logSnap.exists) {
          persistedLog = logSnap.data() || null;
        }
      } catch (readErr) {
        if (requirePersistentTracking) {
          throw readErr;
        }
        persistedLog = null;
      }
    }

    const persistentSmsSent =
      persistedLog?.smsStatus === 'SENT' ||
      liveOutboxData?.smsStatus === 'SENT' ||
      callerKnownStatuses?.smsStatus === 'SENT';
    const persistentEmailSent =
      persistedLog?.emailStatus === 'SENT' ||
      liveOutboxData?.emailStatus === 'SENT' ||
      callerKnownStatuses?.emailStatus === 'SENT';
    const persistentPushSent =
      persistedLog?.pushStatus === 'SENT' ||
      liveOutboxData?.pushStatus === 'SENT' ||
      callerKnownStatuses?.pushStatus === 'SENT';

    // Outbox-owned durable retries never rely on process-local memory for delivery proof;
    // legacy direct callers keep existing in-memory acceleration alongside persistent logs.
    const smsAlreadySent = persistentSmsSent || (!isOutboxOwned && this.processedEvents.has(smsMemKey));
    const emailAlreadySent = persistentEmailSent || (!isOutboxOwned && this.processedEvents.has(emailMemKey));

    // Transaction alerts toggle applies to transaction/non-security alerts; security alerts remain mandatory
    if (category !== 'SECURITY' && prefs.transactionAlerts === false) {
      console.log(`[Notification Dispatcher] Transaction alerts disabled by user preferences for ${event.userId}.`);
      const disabledPersist = await this.persistChannelOutcomes(
        fs,
        event,
        category,
        dispatchKey,
        {
          pushStatus: 'DISABLED_BY_USER',
          smsStatus: 'DISABLED_BY_USER',
          emailStatus: 'DISABLED_BY_USER',
        },
        { outboxContext: outboxCtx, requirePersistentTracking }
      );
      if (disabledPersist.leaseLost) {
        return this.buildLeaseLostSummary(event);
      }
      return {
        transactionId: event.transactionId,
        referenceNumber: event.referenceNumber,
        push: { attempted: false, delivered: false, status: 'DISABLED_BY_USER' },
        sms: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
        email: { success: true, delivered: false, status: 'DISABLED_BY_USER' },
      };
    }

    // Resolve known/terminal push status from outbox or caller before hitting FCM
    const knownOrLivePushStatus = String(liveOutboxData?.pushStatus || callerKnownStatuses?.pushStatus || '');
    const pushKnownTerminal =
      knownOrLivePushStatus === 'NO_ACTIVE_TOKENS' ||
      knownOrLivePushStatus === 'DISABLED_BY_USER' ||
      knownOrLivePushStatus === 'FAILED_PERMANENT';

    // 1. Dispatch Push Notification via Firebase Admin Messaging (HTTP v1) with persistent duplicate protection
    let pushResult: PushDispatchSummary;
    let nextPushSyncStatus: string | undefined;

    if (persistentPushSent) {
      pushResult = { attempted: false, delivered: false, status: 'DUPLICATE_IGNORED' };
      if (persistedLog?.pushStatus !== 'SENT') {
        nextPushSyncStatus = 'SENT';
      }
    } else if (pushKnownTerminal) {
      pushResult = { attempted: false, delivered: false, status: knownOrLivePushStatus };
      if (knownOrLivePushStatus === 'NO_ACTIVE_TOKENS' && persistedLog?.pushStatus !== 'NO_ACTIVE_TOKENS') {
        nextPushSyncStatus = 'NO_ACTIVE_TOKENS';
      }
    } else if (channelSelection?.push === false) {
      pushResult = {
        attempted: false,
        delivered: false,
        status: 'SKIPPED',
      };
    } else if (prefs.pushEnabled === false) {
      pushResult = { attempted: false, delivered: false, status: 'DISABLED_BY_USER' };
      const pushDisabledPersist = await this.persistChannelOutcomes(
        fs,
        event,
        category,
        dispatchKey,
        { pushStatus: 'DISABLED_BY_USER' },
        { outboxContext: outboxCtx, requirePersistentTracking }
      );
      if (pushDisabledPersist.leaseLost) {
        return this.buildLeaseLostSummary(event);
      }
    } else {
      pushResult = await this.sendPush(event, category, outboxCtx, requirePersistentTracking);
    }

    // Immediate abort if outbox or dispatch lease was lost during Push
    if (pushResult.status === 'LEASE_LOST') {
      return this.buildLeaseLostSummary(event, pushResult);
    }

    const supportsSmsTemplate =
      event.type === 'MONEY_RECEIVED' ||
      event.type === 'MONEY_SENT' ||
      event.type === 'SECURITY';
    const supportsEmailTemplate =
      event.type === 'MONEY_RECEIVED' ||
      event.type === 'MONEY_SENT' ||
      event.type === 'SECURITY';

    const knownOrLiveSmsStatus = String(liveOutboxData?.smsStatus || callerKnownStatuses?.smsStatus || '');
    const smsKnownTerminal =
      knownOrLiveSmsStatus === 'DISABLED_BY_USER' ||
      knownOrLiveSmsStatus === 'FAILED_PERMANENT';

    // 2. Dispatch SMS (only if unfinished, enabled, supported, and active outbox lease still verified)
    let smsResult: SmsDispatchResult = { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    let nextSmsChannelStatus: string | undefined;

    if (smsAlreadySent) {
      smsResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
      if (persistentSmsSent && persistedLog?.smsStatus !== 'SENT') {
        nextSmsChannelStatus = 'SENT';
      }
    } else if (smsKnownTerminal) {
      smsResult = {
        success: true,
        delivered: false,
        status: knownOrLiveSmsStatus === 'FAILED_PERMANENT' ? 'INVALID_PHONE' : 'DISABLED_BY_USER',
      };
    } else if (channelSelection?.sms === false) {
      smsResult = {
        success: true,
        delivered: false,
        status:
          knownOrLiveSmsStatus === 'UNCONFIGURED_PROVIDER' && !supportsSmsTemplate
            ? 'UNCONFIGURED_PROVIDER'
            : 'SKIPPED',
      };
    } else if (!supportsSmsTemplate) {
      smsResult = {
        success: true,
        delivered: false,
        status: 'UNCONFIGURED_PROVIDER',
        error: `No SMS template configured for event type "${event.type}"`,
      };
      nextSmsChannelStatus = 'UNCONFIGURED_PROVIDER';
    } else if (prefs.smsEnabled === false) {
      smsResult = { success: true, delivered: false, status: 'DISABLED_BY_USER', error: 'Disabled by user preference' };
      nextSmsChannelStatus = 'DISABLED_BY_USER';
    } else if (!event.recipientPhone) {
      smsResult = { success: true, delivered: false, status: 'INVALID_PHONE', error: 'No phone number on profile' };
      nextSmsChannelStatus = 'FAILED_PERMANENT';
    } else {
      // Immediate pre-send lease check & fresh persistent outbox check before external SMS call
      if (outboxCtx) {
        const preSmsCheck = await this.readOutboxRecordSnapshot(fs, outboxCtx);
        if (!preSmsCheck.leaseValid) {
          return this.buildLeaseLostSummary(event);
        }
        if (preSmsCheck.outboxData?.smsStatus === 'SENT') {
          smsResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
          if (persistedLog?.smsStatus !== 'SENT') {
            nextSmsChannelStatus = 'SENT';
          }
        } else {
          smsResult = await smsService.sendTransactionSms({
            to: event.recipientPhone,
            type: event.type as 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY',
            amount: event.amount,
            currency: event.currency || 'USD',
            senderName: event.senderName,
            recipientName: event.recipientName,
            referenceNumber: event.referenceNumber,
            eventKey: event.eventKey,
          });
        }
      } else {
        smsResult = await smsService.sendTransactionSms({
          to: event.recipientPhone,
          type: event.type as 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY',
          amount: event.amount,
          currency: event.currency || 'USD',
          senderName: event.senderName,
          recipientName: event.recipientName,
          referenceNumber: event.referenceNumber,
          eventKey: event.eventKey,
        });
      }

      if (smsResult.delivered && smsResult.status === 'SENT') {
        this.rememberInMemory(smsMemKey);
        nextSmsChannelStatus = 'SENT';
      } else if (smsResult.status === 'INVALID_PHONE') {
        nextSmsChannelStatus = 'FAILED_PERMANENT';
      } else if (smsResult.status === 'UNCONFIGURED_PROVIDER') {
        nextSmsChannelStatus = 'UNCONFIGURED_PROVIDER';
      } else if (smsResult.status === 'FAILED') {
        nextSmsChannelStatus = 'FAILED_RETRYABLE';
      }
    }

    const knownOrLiveEmailStatus = String(liveOutboxData?.emailStatus || callerKnownStatuses?.emailStatus || '');
    const emailKnownTerminal =
      knownOrLiveEmailStatus === 'DISABLED_BY_USER' ||
      knownOrLiveEmailStatus === 'FAILED_PERMANENT';

    // 3. Dispatch Transactional Email (only if unfinished, enabled, supported, and active outbox lease still verified)
    let emailResult: EmailDispatchResult = { success: true, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    let nextEmailChannelStatus: string | undefined;

    if (emailAlreadySent) {
      emailResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
      if (persistentEmailSent && persistedLog?.emailStatus !== 'SENT') {
        nextEmailChannelStatus = 'SENT';
      }
    } else if (emailKnownTerminal) {
      emailResult = {
        success: true,
        delivered: false,
        status: knownOrLiveEmailStatus === 'FAILED_PERMANENT' ? 'INVALID_EMAIL' : 'DISABLED_BY_USER',
      };
    } else if (channelSelection?.email === false) {
      emailResult = {
        success: true,
        delivered: false,
        status:
          knownOrLiveEmailStatus === 'UNCONFIGURED_PROVIDER' && !supportsEmailTemplate
            ? 'UNCONFIGURED_PROVIDER'
            : 'SKIPPED',
      };
    } else if (!supportsEmailTemplate) {
      emailResult = {
        success: true,
        delivered: false,
        status: 'UNCONFIGURED_PROVIDER',
        error: `No email template configured for event type "${event.type}"`,
      };
      nextEmailChannelStatus = 'UNCONFIGURED_PROVIDER';
    } else if (prefs.emailEnabled === false) {
      emailResult = { success: true, delivered: false, status: 'DISABLED_BY_USER', error: 'Disabled by user preference' };
      nextEmailChannelStatus = 'DISABLED_BY_USER';
    } else if (!event.recipientEmail) {
      emailResult = { success: true, delivered: false, status: 'INVALID_EMAIL', error: 'No email address on profile' };
      nextEmailChannelStatus = 'FAILED_PERMANENT';
    } else {
      // Immediate pre-send lease check & fresh persistent outbox check before external Email call
      if (outboxCtx) {
        const preEmailCheck = await this.readOutboxRecordSnapshot(fs, outboxCtx);
        if (!preEmailCheck.leaseValid) {
          return this.buildLeaseLostSummary(event);
        }
        if (preEmailCheck.outboxData?.emailStatus === 'SENT') {
          emailResult = { success: true, delivered: false, status: 'DUPLICATE_IGNORED' };
          if (persistedLog?.emailStatus !== 'SENT') {
            nextEmailChannelStatus = 'SENT';
          }
        } else {
          emailResult = await emailService.sendTransactionalEmail({
            to: event.recipientEmail,
            recipientName: event.recipientName,
            type: event.type as 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY',
            amount: event.amount,
            currency: event.currency || 'USD',
            senderName: event.senderName,
            referenceNumber: event.referenceNumber,
            eventKey: event.eventKey,
            accountMasked: event.accountMasked,
          });
        }
      } else {
        emailResult = await emailService.sendTransactionalEmail({
          to: event.recipientEmail,
          recipientName: event.recipientName,
          type: event.type as 'MONEY_RECEIVED' | 'MONEY_SENT' | 'SECURITY',
          amount: event.amount,
          currency: event.currency || 'USD',
          senderName: event.senderName,
          referenceNumber: event.referenceNumber,
          eventKey: event.eventKey,
          accountMasked: event.accountMasked,
        });
      }

      if (emailResult.delivered && emailResult.status === 'SENT') {
        this.rememberInMemory(emailMemKey);
        nextEmailChannelStatus = 'SENT';
      } else if (emailResult.status === 'INVALID_EMAIL') {
        nextEmailChannelStatus = 'FAILED_PERMANENT';
      } else if (emailResult.status === 'UNCONFIGURED_PROVIDER') {
        nextEmailChannelStatus = 'UNCONFIGURED_PROVIDER';
      } else if (emailResult.status === 'FAILED') {
        nextEmailChannelStatus = 'FAILED_RETRYABLE';
      }
    }

    if (nextPushSyncStatus || nextSmsChannelStatus || nextEmailChannelStatus) {
      const channelPersist = await this.persistChannelOutcomes(
        fs,
        event,
        category,
        dispatchKey,
        {
          pushStatus: nextPushSyncStatus,
          smsStatus: nextSmsChannelStatus,
          emailStatus: nextEmailChannelStatus,
          smsError: smsResult.error,
          emailError: emailResult.error,
        },
        { outboxContext: outboxCtx, requirePersistentTracking }
      );
      if (channelPersist.leaseLost) {
        return this.buildLeaseLostSummary(event);
      }
    }

    return {
      transactionId: event.transactionId,
      referenceNumber: event.referenceNumber,
      push: pushResult,
      sms: smsResult,
      email: emailResult,
    };
  }

  /**
   * Fetch registered push tokens from users/{userId}/notificationTokens and cross-check
   * ownership against notification_tokens/{tokenId} so one customer's alert can NEVER reach another user's device.
   */
  private async fetchVerifiedUserTokens(fs: Firestore, userId: string): Promise<StoredDeviceToken[]> {
    const subColSnap = await fs.collection('users').doc(userId).collection('notificationTokens').get();
    if (subColSnap.empty) return [];

    const dedupedByToken = new Map<string, StoredDeviceToken>();
    const staleDocIdsToPrune: string[] = [];

    for (const docSnap of subColSnap.docs) {
      const data = docSnap.data() || {};
      const tokenCheck = validatePushToken(data.token);
      if (!tokenCheck.valid || !tokenCheck.token) {
        staleDocIdsToPrune.push(docSnap.id);
        continue;
      }

      const token = tokenCheck.token;
      const canonicalTokenId = computePushTokenId(token);

      // Cross-check document userId field & global ownership index
      if (data.userId && data.userId !== userId) {
        staleDocIdsToPrune.push(docSnap.id);
        continue;
      }

      let belongsToAnotherUser = false;
      for (const candidateGlobalId of new Set([canonicalTokenId, docSnap.id])) {
        const globalSnap = await fs.collection('notification_tokens').doc(candidateGlobalId).get();
        if (globalSnap.exists) {
          const globalUserId = String(globalSnap.data()?.userId || '').trim();
          if (globalUserId && globalUserId !== userId) {
            belongsToAnotherUser = true;
            break;
          }
        }
      }

      if (belongsToAnotherUser) {
        staleDocIdsToPrune.push(docSnap.id);
        continue;
      }

      if (!dedupedByToken.has(token)) {
        dedupedByToken.set(token, {
          docId: docSnap.id,
          tokenId: canonicalTokenId,
          token,
          userId,
        });
      } else {
        // Deduplicate multiple doc IDs holding the same token (prefer canonical SHA-256 docId)
        const existing = dedupedByToken.get(token)!;
        if (docSnap.id === canonicalTokenId && existing.docId !== canonicalTokenId) {
          staleDocIdsToPrune.push(existing.docId);
          dedupedByToken.set(token, {
            docId: docSnap.id,
            tokenId: canonicalTokenId,
            token,
            userId,
          });
        } else {
          staleDocIdsToPrune.push(docSnap.id);
        }
      }
    }

    // Best-effort cleanup of mismatched/stale subcollection refs without deleting global docs owned by others
    if (staleDocIdsToPrune.length > 0) {
      await Promise.all(
        staleDocIdsToPrune.map((docId) =>
          fs
            .collection('users')
            .doc(userId)
            .collection('notificationTokens')
            .doc(docId)
            .delete()
            .catch(() => {})
        )
      );
    }

    return Array.from(dedupedByToken.values());
  }

  /**
   * Remove permanently invalid or unregistered tokens from user subcollection and global index (only if still owned by userId).
   */
  private async removeInvalidToken(fs: Firestore, userId: string, device: StoredDeviceToken): Promise<void> {
    const candidateIds = Array.from(
      new Set([device.docId, device.tokenId, computeLegacyPushTokenId(device.token)])
    );

    await Promise.all(
      candidateIds.map(async (id) => {
        await fs
          .collection('users')
          .doc(userId)
          .collection('notificationTokens')
          .doc(id)
          .delete()
          .catch(() => {});

        try {
          await fs.runTransaction(async (tx) => {
            const globalRef = fs.collection('notification_tokens').doc(id);
            const snap = await tx.get(globalRef);
            if (snap.exists && snap.data()?.userId === userId) {
              tx.delete(globalRef);
            }
          });
        } catch {
          // Non-blocking cleanup
        }
      })
    );
  }

  /**
   * Atomically claim or resume a persistent Firestore dispatch lease.
   * Never marks SENT prior to FCM delivery confirmation; skips devices already confirmed in partial deliveries.
   * NO_ACTIVE_TOKENS is terminal for the event key so historical events cannot fire unexpectedly if a device registers later.
   */
  private async claimPersistentDispatchLease(
    fs: Firestore,
    event: DispatchNotificationEvent,
    category: NotificationCategory
  ): Promise<{
    proceed: boolean;
    skipStatus?: string;
    logRef: FirebaseFirestore.DocumentReference;
    leaseToken: string;
    alreadyDeliveredTokenIds: Set<string>;
  }> {
    const eventKey = resolveDispatchKey(event);
    const docId = computeDispatchLogId(event.userId, eventKey);
    const logRef = fs.collection('notification_dispatch_logs').doc(docId);
    const leaseDuration = this.deps.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;
    const leaseToken = crypto.randomBytes(16).toString('hex');
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const leaseExpiresIso = new Date(nowMs + leaseDuration).toISOString();

    const claimOutcome = await fs.runTransaction(async (tx) => {
      const snap = await tx.get(logRef);
      if (!snap.exists) {
        tx.set(logRef, {
          dispatchKey: eventKey,
          ...(event.eventKey ? { eventKey: event.eventKey } : {}),
          ...(event.lifecycleStage ? { lifecycleStage: event.lifecycleStage } : {}),
          userId: event.userId,
          transactionId: event.transactionId || event.referenceNumber,
          referenceNumber: event.referenceNumber,
          category,
          pushStatus: 'CLAIMED',
          smsStatus: 'PENDING',
          emailStatus: 'PENDING',
          leaseOwner: this.instanceId,
          leaseToken,
          leaseExpiresAt: leaseExpiresIso,
          deliveredTokenIds: [],
          failedTokens: [],
          removedInvalidTokens: 0,
          attemptCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        return { proceed: true, alreadyDelivered: [] as string[] };
      }

      const data = snap.data() || {};
      const status = String(data.pushStatus || '');
      if (status === 'SENT') {
        return { proceed: false, skipStatus: 'DUPLICATE_IGNORED', alreadyDelivered: [] as string[] };
      }

      if (status === 'NO_ACTIVE_TOKENS') {
        return { proceed: false, skipStatus: 'NO_ACTIVE_TOKENS', alreadyDelivered: [] as string[] };
      }

      const existingLeaseExpiry = data.leaseExpiresAt ? Date.parse(String(data.leaseExpiresAt)) : 0;
      if (status === 'CLAIMED' && Number.isFinite(existingLeaseExpiry) && existingLeaseExpiry > nowMs) {
        return { proceed: false, skipStatus: 'DUPLICATE_IN_FLIGHT', alreadyDelivered: [] as string[] };
      }

      // Eligible for retry recovery: FAILED, PARTIAL, or expired CLAIMED lease
      const prevAttempts = Number(data.attemptCount || 0);
      const deliveredIds = Array.isArray(data.deliveredTokenIds) ? data.deliveredTokenIds.map(String) : [];

      tx.set(
        logRef,
        {
          pushStatus: 'CLAIMED',
          leaseOwner: this.instanceId,
          leaseToken,
          leaseExpiresAt: leaseExpiresIso,
          attemptCount: prevAttempts + 1,
          updatedAt: nowIso,
        },
        { merge: true }
      );

      return { proceed: true, alreadyDelivered: deliveredIds };
    });

    return {
      proceed: claimOutcome.proceed,
      skipStatus: claimOutcome.skipStatus,
      logRef,
      leaseToken,
      alreadyDeliveredTokenIds: new Set(claimOutcome.alreadyDelivered),
    };
  }

  /**
   * Atomically update notification_dispatch_logs ONLY if this dispatcher invocation still owns the active CLAIMED lease.
   * Unions confirmed deliveredTokenIds with previously stored IDs so batch progress is never lost or overwritten.
   */
  private async updateDispatchRecordAsLeaseOwner(
    fs: Firestore,
    logRef: FirebaseFirestore.DocumentReference,
    leaseToken: string,
    newDeliveredIds: string[],
    fields: Record<string, any>,
    outboxCtx?: OutboxDispatchOwnershipContext
  ): Promise<{ leaseLost: boolean; mergedDeliveredIds: string[] }> {
    const outboxRef = outboxCtx
      ? fs.collection(outboxCtx.outboxCollection || 'notification_outbox').doc(outboxCtx.outboxId)
      : null;

    return fs.runTransaction(async (tx) => {
      const [snap, outboxSnap] = await Promise.all([
        tx.get(logRef),
        outboxRef ? tx.get(outboxRef) : Promise.resolve(null),
      ]);

      if (!snap.exists) {
        return { leaseLost: true, mergedDeliveredIds: [] };
      }

      if (outboxCtx) {
        if (!outboxSnap?.exists) {
          return { leaseLost: true, mergedDeliveredIds: [] };
        }
        const outboxData = outboxSnap.data() || {};
        if (
          outboxData.status !== 'PROCESSING' ||
          !outboxData.leaseToken ||
          outboxData.leaseToken !== outboxCtx.leaseToken
        ) {
          return { leaseLost: true, mergedDeliveredIds: [] };
        }
        const effectiveNowMs = outboxCtx.nowMs ?? Date.now();
        if (outboxData.leaseExpiresAt) {
          const expMs = Date.parse(String(outboxData.leaseExpiresAt));
          if (Number.isFinite(expMs) && expMs <= effectiveNowMs) {
            return { leaseLost: true, mergedDeliveredIds: [] };
          }
        }
      }

      const data = snap.data() || {};
      if (
        data.pushStatus !== 'CLAIMED' ||
        data.leaseOwner !== this.instanceId ||
        (data.leaseToken && data.leaseToken !== leaseToken)
      ) {
        return { leaseLost: true, mergedDeliveredIds: [] };
      }

      const existingDelivered = Array.isArray(data.deliveredTokenIds)
        ? data.deliveredTokenIds.map(String)
        : [];
      const mergedDeliveredIds = Array.from(new Set([...existingDelivered, ...newDeliveredIds]));

      tx.set(
        logRef,
        {
          ...fields,
          deliveredTokenIds: mergedDeliveredIds,
        },
        { merge: true }
      );

      return { leaseLost: false, mergedDeliveredIds };
    });
  }

  /**
   * Send push notification via Firebase Admin Messaging (FCM HTTP v1)
   */
  private async sendPush(
    event: DispatchNotificationEvent,
    category: NotificationCategory,
    outboxCtx?: OutboxDispatchOwnershipContext,
    requirePersistentTracking: boolean = false
  ): Promise<PushDispatchSummary> {
    const fs = this.getFirestore();
    const messaging = this.getMessaging();

    if (!fs || !messaging) {
      return { attempted: false, delivered: false, status: 'UNCONFIGURED_PROVIDER' };
    }

    if (outboxCtx) {
      const leaseCheck = await this.readOutboxRecordSnapshot(fs, outboxCtx);
      if (!leaseCheck.leaseValid) {
        return { attempted: false, delivered: false, status: 'LEASE_LOST' };
      }
    }

    // 1. Claim persistent dispatch lease before hitting FCM
    let lease: Awaited<ReturnType<ServerNotificationDispatcher['claimPersistentDispatchLease']>>;
    try {
      lease = await this.claimPersistentDispatchLease(fs, event, category);
    } catch (leaseErr: any) {
      console.warn('[Push Service] Dispatch lease claim error:', leaseErr?.message || leaseErr);
      if (requirePersistentTracking) {
        throw leaseErr;
      }
      return { attempted: false, delivered: false, status: 'LEASE_ERROR' };
    }

    if (!lease.proceed) {
      return {
        attempted: false,
        delivered: false,
        status: lease.skipStatus || 'DUPLICATE_IGNORED',
      };
    }

    const leaseDuration = this.deps.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;

    // 2. Resolve and verify registered customer devices (or test override tokens if explicitly provided internally)
    let devices: StoredDeviceToken[] = [];
    try {
      if (event.pushTokens && event.pushTokens.length > 0) {
        const seen = new Set<string>();
        for (const rawTok of event.pushTokens) {
          const checked = validatePushToken(rawTok);
          if (checked.valid && checked.token && !seen.has(checked.token)) {
            seen.add(checked.token);
            const tid = computePushTokenId(checked.token);
            devices.push({ docId: tid, tokenId: tid, token: checked.token, userId: event.userId });
          }
        }
      } else {
        devices = await this.fetchVerifiedUserTokens(fs, event.userId);
      }
    } catch (tokErr: any) {
      const errIso = new Date().toISOString();
      const errUpdate = await this.updateDispatchRecordAsLeaseOwner(
        fs,
        lease.logRef,
        lease.leaseToken,
        [],
        {
          pushStatus: 'FAILED',
          lastError: tokErr?.message || 'Token lookup failed',
          leaseExpiresAt: errIso,
          updatedAt: errIso,
        },
        outboxCtx
      ).catch((uErr) => {
        if (requirePersistentTracking) throw uErr;
        return { leaseLost: false, mergedDeliveredIds: [] };
      });
      if (errUpdate.leaseLost) {
        return { attempted: false, delivered: false, status: 'LEASE_LOST' };
      }
      return { attempted: true, delivered: false, status: 'FAILED' };
    }

    // Filter out devices that already received this notification in a prior partial attempt
    const pendingDevices = devices.filter((d) => !lease.alreadyDeliveredTokenIds.has(d.tokenId));

    if (devices.length === 0) {
      const doneIso = new Date().toISOString();
      if (lease.alreadyDeliveredTokenIds.size > 0) {
        const prevSentUpdate = await this.updateDispatchRecordAsLeaseOwner(
          fs,
          lease.logRef,
          lease.leaseToken,
          [],
          {
            pushStatus: 'SENT',
            sentAt: doneIso,
            leaseExpiresAt: doneIso,
            updatedAt: doneIso,
          },
          outboxCtx
        ).catch((uErr) => {
          if (requirePersistentTracking) throw uErr;
          return { leaseLost: false, mergedDeliveredIds: Array.from(lease.alreadyDeliveredTokenIds) };
        });
        if (prevSentUpdate.leaseLost) {
          return { attempted: false, delivered: false, status: 'LEASE_LOST' };
        }
        return {
          attempted: false,
          delivered: true,
          status: 'SENT',
          targetedDevices: 0,
          deliveredDevices: lease.alreadyDeliveredTokenIds.size,
        };
      }

      const noTokUpdate = await this.updateDispatchRecordAsLeaseOwner(
        fs,
        lease.logRef,
        lease.leaseToken,
        [],
        {
          pushStatus: 'NO_ACTIVE_TOKENS',
          leaseExpiresAt: doneIso,
          updatedAt: doneIso,
        },
        outboxCtx
      ).catch((uErr) => {
        if (requirePersistentTracking) throw uErr;
        return { leaseLost: false, mergedDeliveredIds: [] };
      });
      if (noTokUpdate.leaseLost) {
        return { attempted: false, delivered: false, status: 'LEASE_LOST' };
      }
      return { attempted: false, delivered: false, status: 'NO_ACTIVE_TOKENS', targetedDevices: 0 };
    }

    if (pendingDevices.length === 0 && lease.alreadyDeliveredTokenIds.size > 0) {
      const doneIso = new Date().toISOString();
      const pendingDoneUpdate = await this.updateDispatchRecordAsLeaseOwner(
        fs,
        lease.logRef,
        lease.leaseToken,
        [],
        {
          pushStatus: 'SENT',
          sentAt: doneIso,
          leaseExpiresAt: doneIso,
          updatedAt: doneIso,
        },
        outboxCtx
      ).catch((uErr) => {
        if (requirePersistentTracking) throw uErr;
        return { leaseLost: false, mergedDeliveredIds: Array.from(lease.alreadyDeliveredTokenIds) };
      });
      if (pendingDoneUpdate.leaseLost) {
        return { attempted: false, delivered: false, status: 'LEASE_LOST' };
      }
      return {
        attempted: false,
        delivered: true,
        status: 'SENT',
        targetedDevices: devices.length,
        deliveredDevices: lease.alreadyDeliveredTokenIds.size,
      };
    }

    // 3. Build sanitized FCM HTTP v1 Web Push payload compatible with unified src/sw.ts
    const content = formatSafePushContent(event);
    const nowIso = new Date().toISOString();

    const newlyDeliveredIds: string[] = [];
    const transientFailures: Array<{ tokenId: string; code: string; permanent: boolean; category?: string }> = [];
    let removedInvalidCount = 0;
    let loggedCredentialDiagnostic = false;

    const emitCredentialDiagnostic = () => {
      if (loggedCredentialDiagnostic) return;
      loggedCredentialDiagnostic = true;
      console.error(
        '[Push Service] CRITICAL CONFIGURATION/CREDENTIAL ERROR (messaging/mismatched-credential): Firebase Admin credential lacks Cloud Messaging permission or does not match the client project/sender ID. Customer device tokens were preserved. Inspect FIREBASE_PROJECT_ID, Firebase Admin service account project alignment, and Cloud Messaging IAM permissions (cloudmessaging.messages.create).'
      );
    };

    // 4. Send in batches <= 500 per FCM sendEachForMulticast limits, checkpointing confirmed IDs after each batch
    for (let i = 0; i < pendingDevices.length; i += FCM_MULTICAST_BATCH_SIZE) {
      if (outboxCtx) {
        const batchLease = await this.readOutboxRecordSnapshot(fs, outboxCtx);
        if (!batchLease.leaseValid) {
          return {
            attempted: i > 0,
            delivered: newlyDeliveredIds.length > 0,
            status: 'LEASE_LOST',
            targetedDevices: pendingDevices.length,
            deliveredDevices: new Set([...lease.alreadyDeliveredTokenIds, ...newlyDeliveredIds]).size,
            failedDevices: transientFailures.length,
            removedInvalidTokens: removedInvalidCount,
          };
        }
      }

      const batch = pendingDevices.slice(i, i + FCM_MULTICAST_BATCH_SIZE);
      const batchDeliveredIds: string[] = [];

      try {
        const batchResponse = await messaging.sendEachForMulticast({
          tokens: batch.map((d) => d.token),
          notification: {
            title: content.title,
            body: content.body,
          },
          webpush: {
            headers: {
              Urgency: 'high',
              TTL: '86400',
            },
            notification: {
              title: content.title,
              body: content.body,
              icon: '/pwa-192x192.png',
              badge: '/pwa-192x192.png',
              tag: content.safeRef,
              renotify: true,
              data: {
                url: content.url,
                referenceId: content.safeRef,
                category: content.category,
              },
            },
            fcmOptions: {
              link: content.url,
            },
          },
          data: {
            title: content.title,
            body: content.body,
            referenceId: content.safeRef,
            transactionId: String(event.transactionId || content.safeRef),
            type: String(event.type),
            category: content.category,
            url: content.url,
            timestamp: nowIso,
          },
        });

        for (let idx = 0; idx < batchResponse.responses.length; idx++) {
          const itemResp = batchResponse.responses[idx];
          const targetDevice = batch[idx];
          if (itemResp.success) {
            batchDeliveredIds.push(targetDevice.tokenId);
            newlyDeliveredIds.push(targetDevice.tokenId);
          } else {
            const errCode = String((itemResp.error as any)?.code || 'messaging/unknown-error');
            if (PERMANENT_INVALID_TOKEN_CODES.has(errCode)) {
              removedInvalidCount++;
              await this.removeInvalidToken(fs, event.userId, targetDevice);
            } else if (errCode === CREDENTIAL_MISMATCH_ERROR_CODE) {
              emitCredentialDiagnostic();
              transientFailures.push({
                tokenId: targetDevice.tokenId,
                code: errCode,
                permanent: false,
                category: 'CONFIGURATION_OR_CREDENTIAL',
              });
            } else {
              transientFailures.push({
                tokenId: targetDevice.tokenId,
                code: errCode,
                permanent: false,
              });
            }
          }
        }
      } catch (batchErr: any) {
        const errCode = String(batchErr?.code || 'messaging/batch-error');
        if (errCode === CREDENTIAL_MISMATCH_ERROR_CODE) {
          emitCredentialDiagnostic();
        }
        for (const targetDevice of batch) {
          transientFailures.push({
            tokenId: targetDevice.tokenId,
            code: errCode,
            permanent: false,
            ...(errCode === CREDENTIAL_MISMATCH_ERROR_CODE ? { category: 'CONFIGURATION_OR_CREDENTIAL' } : {}),
          });
        }
      }

      // Immediately checkpoint confirmed batch progress and renew active lease while maintaining CLAIMED status
      const hasMoreBatches = i + FCM_MULTICAST_BATCH_SIZE < pendingDevices.length;
      if (hasMoreBatches || batchDeliveredIds.length > 0) {
        const checkpointMs = Date.now();
        const checkpointResult = await this.updateDispatchRecordAsLeaseOwner(
          fs,
          lease.logRef,
          lease.leaseToken,
          batchDeliveredIds,
          {
            pushStatus: 'CLAIMED',
            failedTokens: transientFailures,
            removedInvalidTokens: removedInvalidCount,
            leaseExpiresAt: new Date(checkpointMs + leaseDuration).toISOString(),
            updatedAt: new Date(checkpointMs).toISOString(),
          },
          outboxCtx
        );

        if (checkpointResult.leaseLost) {
          console.warn(
            `[Push Service] Lease ownership lost during multi-batch checkpoint for ${event.userId}; halting stale worker.`
          );
          const mergedDeliveredCount = new Set([...lease.alreadyDeliveredTokenIds, ...newlyDeliveredIds]).size;
          return {
            attempted: true,
            delivered: mergedDeliveredCount > 0,
            status: 'LEASE_LOST',
            targetedDevices: pendingDevices.length,
            deliveredDevices: mergedDeliveredCount,
            failedDevices: transientFailures.length,
            removedInvalidTokens: removedInvalidCount,
          };
        }
      }
    }

    const totalDeliveredIds = Array.from(
      new Set([...lease.alreadyDeliveredTokenIds, ...newlyDeliveredIds])
    );
    const finishIso = new Date().toISOString();

    let finalStatus: 'SENT' | 'PARTIAL' | 'FAILED' | 'NO_ACTIVE_TOKENS';
    if (transientFailures.length > 0) {
      finalStatus = totalDeliveredIds.length > 0 ? 'PARTIAL' : 'FAILED';
    } else if (totalDeliveredIds.length > 0) {
      finalStatus = 'SENT';
    } else if (removedInvalidCount > 0) {
      finalStatus = 'NO_ACTIVE_TOKENS';
    } else {
      finalStatus = 'FAILED';
    }

    const finalUpdate = await this.updateDispatchRecordAsLeaseOwner(
      fs,
      lease.logRef,
      lease.leaseToken,
      newlyDeliveredIds,
      {
        pushStatus: finalStatus,
        failedTokens: transientFailures,
        removedInvalidTokens: removedInvalidCount,
        leaseExpiresAt: finishIso,
        updatedAt: finishIso,
        ...(finalStatus === 'SENT' ? { sentAt: finishIso } : {}),
      },
      outboxCtx
    ).catch((err) => {
      if (requirePersistentTracking) {
        throw err;
      }
      return { leaseLost: true, mergedDeliveredIds: totalDeliveredIds };
    });

    if (finalUpdate.leaseLost) {
      console.warn(
        `[Push Service] Lease ownership lost prior to finalization for ${event.userId}; refusing to overwrite newer worker state.`
      );
      return {
        attempted: true,
        delivered: totalDeliveredIds.length > 0,
        status: 'LEASE_LOST',
        targetedDevices: pendingDevices.length,
        deliveredDevices: totalDeliveredIds.length,
        failedDevices: transientFailures.length,
        removedInvalidTokens: removedInvalidCount,
      };
    }

    return {
      attempted: true,
      delivered: finalUpdate.mergedDeliveredIds.length > 0,
      status: finalStatus,
      targetedDevices: pendingDevices.length,
      deliveredDevices: finalUpdate.mergedDeliveredIds.length,
      failedDevices: transientFailures.length,
      removedInvalidTokens: removedInvalidCount,
    };
  }

  /**
   * Dispatch a typed notification to a user with persistent Firestore storage and multi-channel fan-out.
   * Preserves the real notification category instead of coercing all notifications to SECURITY.
   */
  public async dispatchNotification(
    userId: string,
    notification: {
      id?: string;
      title: string;
      message: string;
      type?: NotificationCategory;
      severity?: 'info' | 'success' | 'warning' | 'error' | 'support';
      referenceId?: string;
      actionView?: 'overview' | 'transactions' | 'accounts' | 'transfers' | 'investments' | 'loans' | 'cards' | 'profile';
      actionModal?: 'withdraw' | 'deposit' | 'send' | 'invest' | 'receive';
      actionSection?: string;
      actionRecordId?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    if (!userId) return;
    const nowIso = new Date().toISOString();
    const safeRef = notification.referenceId || `NOTIF-${Date.now().toString().slice(-8)}`;
    const notifId =
      notification.id ||
      `notif_sys_${userId}_${safeRef.replace(/[^a-zA-Z0-9_-]/g, '')}_${Date.now()}`;
    const realCategory: NotificationCategory = notification.type || 'SYSTEM';

    const persistFn = this.deps.persistNotification || persistCustomerNotification;
    await persistFn({
      id: notifId,
      userId,
      title: notification.title,
      message: notification.message,
      type: realCategory,
      severity: notification.severity || 'info',
      referenceId: notification.referenceId,
      createdAt: nowIso,
      actionView: notification.actionView,
      actionModal: notification.actionModal,
      actionSection: notification.actionSection,
      actionRecordId: notification.actionRecordId,
      metadata: notification.metadata,
    }).catch((err) => console.warn('[Notification Dispatcher] Persist note:', err?.message || err));

    await this.dispatch({
      transactionId: notifId,
      referenceNumber: safeRef,
      type: realCategory,
      category: realCategory,
      userId,
      title: notification.title,
      body: notification.message,
      actionUrl: notification.actionView ? `/dashboard?view=${notification.actionView}` : '/dashboard',
    }).catch(() => {});
  }
}

export const serverNotificationDispatcher = new ServerNotificationDispatcher();

