// Monvera Digital Banking — Stage 3D-A Durable Notification Outbox Foundation
// Establishes the outbox schema, deterministic IDs, per-channel state tracking,
// CSPRNG lease-token fencing, and query helpers.
// NOTE: Intentionally NOT wired into any financial transaction flows in Stage 3D-A.

import crypto from 'crypto';
import type { DocumentReference, Firestore, Query, Transaction as FirestoreTransaction } from 'firebase-admin/firestore';
import {
  type DispatchEventType,
  type DispatchExecutionOptions,
  type DispatchNotificationEvent,
  type DispatchResultSummary,
  type NotificationCategory,
  type TransactionNotificationLifecycleStage,
  computeDispatchLogId,
  resolveDispatchKey,
} from './notificationDispatcher';
import { maskAccountNumber } from './notificationStore';

export const NOTIFICATION_OUTBOX_COLLECTION = 'notification_outbox';
export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 8;
export const DEFAULT_OUTBOX_LEASE_DURATION_MS = 60_000;

export interface OutboxChannelRequirementPolicy {
  /**
   * Push is contractually required: missing push configuration or transient push failures keep
   * the outbox entry retryable (`FAILED_RETRYABLE`) up to `maxAttempts`.
   */
  pushRequired: true;
  /**
   * SMS and Email are explicitly BEST-EFFORT for missing provider credentials (`UNCONFIGURED_PROVIDER`)
   * unless overridden: transient HTTP/gateway failures (`FAILED_RETRYABLE`) ARE retried while attempts
   * remain, whereas `UNCONFIGURED_PROVIDER` preserves its actual status (never falsified as `SENT`)
   * and does not block `DISPATCHED` settlement once Push reaches a terminal outcome.
   */
  smsPolicy: 'BEST_EFFORT_RETRY_TRANSIENT';
  emailPolicy: 'BEST_EFFORT_RETRY_TRANSIENT';
}

export const DEFAULT_OUTBOX_CHANNEL_POLICY: Readonly<OutboxChannelRequirementPolicy> = {
  pushRequired: true,
  smsPolicy: 'BEST_EFFORT_RETRY_TRANSIENT',
  emailPolicy: 'BEST_EFFORT_RETRY_TRANSIENT',
};

export type OutboxLifecycleStage = TransactionNotificationLifecycleStage | 'COMPLETED';

export type OutboxStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'DISPATCHED'
  | 'FAILED_RETRYABLE'
  | 'DEAD_LETTER';

export type OutboxPushStatus =
  | 'PENDING'
  | 'CLAIMED'
  | 'SENT'
  | 'PARTIAL'
  | 'NO_ACTIVE_TOKENS'
  | 'DISABLED_BY_USER'
  | 'UNCONFIGURED_PROVIDER'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT';

export type OutboxMessageChannelStatus =
  | 'PENDING'
  | 'SENT'
  | 'DISABLED_BY_USER'
  | 'UNCONFIGURED_PROVIDER'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT';

export type OutboxFailureClassification =
  | 'NONE'
  | 'TRANSIENT'
  | 'MISSING_CONFIGURATION'
  | 'PERMANENT_INVALID_PAYLOAD';

export const OUTBOX_STATES: readonly OutboxStatus[] = [
  'PENDING',
  'PROCESSING',
  'DISPATCHED',
  'FAILED_RETRYABLE',
  'DEAD_LETTER',
] as const;

export const OUTBOX_TERMINAL_STATES: ReadonlySet<OutboxStatus> = new Set<OutboxStatus>([
  'DISPATCHED',
  'DEAD_LETTER',
]);

export const PUSH_CHANNEL_STATES: readonly OutboxPushStatus[] = [
  'PENDING',
  'CLAIMED',
  'SENT',
  'PARTIAL',
  'NO_ACTIVE_TOKENS',
  'DISABLED_BY_USER',
  'UNCONFIGURED_PROVIDER',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
] as const;

export const MESSAGE_CHANNEL_STATES: readonly OutboxMessageChannelStatus[] = [
  'PENDING',
  'SENT',
  'DISABLED_BY_USER',
  'UNCONFIGURED_PROVIDER',
  'FAILED_RETRYABLE',
  'FAILED_PERMANENT',
] as const;

/**
 * Permitted outbox state machine transitions.
 * Terminal states ('DISPATCHED', 'DEAD_LETTER') allow no further transitions.
 */
export const ALLOWED_OUTBOX_TRANSITIONS: Record<OutboxStatus, readonly OutboxStatus[]> = {
  PENDING: ['PROCESSING'],
  FAILED_RETRYABLE: ['PROCESSING', 'DEAD_LETTER'],
  PROCESSING: ['DISPATCHED', 'FAILED_RETRYABLE', 'DEAD_LETTER', 'PROCESSING'],
  DISPATCHED: [],
  DEAD_LETTER: [],
};

export function isValidOutboxStatus(status: unknown): status is OutboxStatus {
  return typeof status === 'string' && (OUTBOX_STATES as readonly string[]).includes(status);
}

export function isValidOutboxTransition(from: OutboxStatus, to: OutboxStatus): boolean {
  return (ALLOWED_OUTBOX_TRANSITIONS[from] || []).includes(to);
}

export interface MaskedNotificationOutboxPayload {
  title?: string;
  body?: string;
  actionUrl?: string;
  amount?: number;
  currency?: string;
  senderName?: string;
  recipientName?: string;
  accountMasked?: string;
}

export interface NotificationOutboxRecord {
  id: string;
  userId: string;
  transactionId: string;
  referenceNumber: string;
  eventKey: string;
  lifecycleStage: OutboxLifecycleStage;
  dispatchType: DispatchEventType;
  category: NotificationCategory;
  payload: MaskedNotificationOutboxPayload;
  status: OutboxStatus;
  pushStatus: OutboxPushStatus;
  smsStatus: OutboxMessageChannelStatus;
  emailStatus: OutboxMessageChannelStatus;
  failureClassification: OutboxFailureClassification;
  attemptCount: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
}

const FORBIDDEN_SENSITIVE_KEYS = new Set<string>([
  'pushTokens',
  'fcmToken',
  'rawFcmToken',
  'token',
  'tokens',
  'accountNumber',
  'senderAccountNumber',
  'recipientAccountNumber',
  'destinationBankAccountNumber',
  'destinationBankRoutingNumber',
  'routingNumber',
  'password',
  'secret',
  'credentials',
  'credential',
  'privateKey',
  'apiKey',
  'recipientEmail',
  'recipientPhone',
  'email',
  'phone',
  'phoneNumber',
  'ssn',
  'taxId',
]);

/**
 * Deterministic backend-only Firestore document ID:
 * SHA256(userId + "::" + eventKey + "::" + dispatchType)
 */
export function computeNotificationOutboxId(
  userId: string,
  eventKey: string,
  dispatchType: DispatchEventType
): string {
  const cleanUser = String(userId || '').trim();
  const cleanEventKey = String(eventKey || '').trim();
  const cleanType = String(dispatchType || '').trim();

  if (!cleanUser || !cleanEventKey || !cleanType) {
    throw new Error('userId, eventKey, and dispatchType are required to compute notification outbox ID.');
  }

  return crypto
    .createHash('sha256')
    .update(`${cleanUser}::${cleanEventKey}::${cleanType}`)
    .digest('hex');
}

/**
 * Generates an unpredictable 128-bit cryptographic lease token for outbox fencing.
 */
export function generateOutboxLeaseToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeRelativeUrl(rawUrl?: string): string | undefined {
  if (typeof rawUrl !== 'string') return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/dashboard';
  }
  return trimmed.slice(0, 200);
}

/**
 * Validates and constructs a strictly masked outbox payload.
 * Rejects any attempt to persist raw FCM tokens, unmasked account/routing numbers, emails, phones, or secrets.
 */
export function sanitizeAndValidateOutboxPayload(
  rawPayload: Record<string, any>
): { valid: boolean; payload?: MaskedNotificationOutboxPayload; error?: string } {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { valid: false, error: 'INVALID_PAYLOAD: Outbox payload must be a plain object.' };
  }

  for (const key of Object.keys(rawPayload)) {
    if (FORBIDDEN_SENSITIVE_KEYS.has(key)) {
      return {
        valid: false,
        error: `INVALID_PAYLOAD: Sensitive field "${key}" is strictly forbidden inside notification_outbox.`,
      };
    }
  }

  const out: MaskedNotificationOutboxPayload = {};

  if (rawPayload.title !== undefined) {
    out.title = String(rawPayload.title).trim().slice(0, 120);
  }
  if (rawPayload.body !== undefined) {
    const cleanBody = String(rawPayload.body).trim().slice(0, 320);
    if (/\b\d{8,}\b/.test(cleanBody)) {
      return {
        valid: false,
        error: 'INVALID_PAYLOAD: Unmasked 8+ digit numeric identifier is forbidden in outbox body.',
      };
    }
    out.body = cleanBody;
  }
  if (rawPayload.actionUrl !== undefined) {
    out.actionUrl = sanitizeRelativeUrl(String(rawPayload.actionUrl));
  }
  if (rawPayload.amount !== undefined) {
    const amt = Number(rawPayload.amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return { valid: false, error: 'INVALID_PAYLOAD: Amount must be a finite positive number.' };
    }
    out.amount = amt;
  }
  if (rawPayload.currency !== undefined) {
    out.currency = String(rawPayload.currency).trim().slice(0, 12) || 'USD';
  }
  if (rawPayload.senderName !== undefined) {
    out.senderName = String(rawPayload.senderName).trim().slice(0, 80);
  }
  if (rawPayload.recipientName !== undefined) {
    out.recipientName = String(rawPayload.recipientName).trim().slice(0, 80);
  }
  if (rawPayload.accountMasked !== undefined) {
    const rawAcc = String(rawPayload.accountMasked).trim();
    out.accountMasked = /\d{6,}/.test(rawAcc)
      ? maskAccountNumber(rawAcc)
      : rawAcc.slice(0, 60);
  }

  return { valid: true, payload: out };
}

export interface CreateOutboxRecordInput {
  userId: string;
  transactionId: string;
  referenceNumber: string;
  eventKey: string;
  lifecycleStage: OutboxLifecycleStage;
  dispatchType: DispatchEventType;
  category?: NotificationCategory;
  payload: MaskedNotificationOutboxPayload;
  maxAttempts?: number;
  nowIso?: string;
}

function inferCategoryFromDispatchType(dispatchType: DispatchEventType): NotificationCategory {
  if (dispatchType === 'SECURITY') return 'SECURITY';
  if (dispatchType === 'INVESTMENT') return 'INVESTMENT';
  if (dispatchType === 'SYSTEM') return 'SYSTEM';
  if (dispatchType === 'SUPPORT') return 'SUPPORT';
  return 'TRANSACTION';
}

export interface PreparedNotificationOutboxItem {
  valid: true;
  outboxId: string;
  record: NotificationOutboxRecord;
}

export interface InvalidPreparedNotificationOutboxItem {
  valid: false;
  outboxId?: string;
  userId?: string;
  eventKey?: string;
  dispatchType?: DispatchEventType;
  error: string;
}

export type PrepareNotificationOutboxResult =
  | PreparedNotificationOutboxItem
  | InvalidPreparedNotificationOutboxItem;

/**
 * Pure, non-throwing preparation helper that validates and constructs a masked outbox record
 * without performing any Firestore reads or writes. Safe to invoke prior to entering a
 * financial Firestore transaction.
 */
export function prepareNotificationOutboxRecord(input: CreateOutboxRecordInput): PrepareNotificationOutboxResult {
  if (!input || typeof input !== 'object') {
    return { valid: false, error: 'INVALID_INPUT: Outbox input must be an object.' };
  }

  const userId = String(input.userId || '').trim();
  const transactionId = String(input.transactionId || '').trim();
  const referenceNumber = String(input.referenceNumber || '').trim();
  const eventKey = String(input.eventKey || '').trim();
  const dispatchType = String(input.dispatchType || '').trim() as DispatchEventType;

  let candidateOutboxId: string | undefined;
  if (userId && eventKey && dispatchType) {
    candidateOutboxId = computeNotificationOutboxId(userId, eventKey, dispatchType);
  }

  if (!userId || !transactionId || !referenceNumber || !eventKey || !dispatchType) {
    return {
      valid: false,
      outboxId: candidateOutboxId,
      userId: userId || undefined,
      eventKey: eventKey || undefined,
      dispatchType: dispatchType || undefined,
      error: 'INVALID_PAYLOAD: userId, transactionId, referenceNumber, eventKey, and dispatchType are required.',
    };
  }

  const payloadCheck = sanitizeAndValidateOutboxPayload(input.payload as Record<string, any>);
  if (!payloadCheck.valid || !payloadCheck.payload) {
    return {
      valid: false,
      outboxId: candidateOutboxId,
      userId,
      eventKey,
      dispatchType,
      error: payloadCheck.error || 'INVALID_PAYLOAD: Invalid notification outbox payload.',
    };
  }

  const outboxId = candidateOutboxId!;
  const nowIso = input.nowIso || new Date().toISOString();
  const maxAttempts =
    typeof input.maxAttempts === 'number' && Number.isInteger(input.maxAttempts) && input.maxAttempts > 0
      ? input.maxAttempts
      : DEFAULT_OUTBOX_MAX_ATTEMPTS;

  const record: NotificationOutboxRecord = {
    id: outboxId,
    userId,
    transactionId,
    referenceNumber,
    eventKey,
    lifecycleStage: input.lifecycleStage,
    dispatchType,
    category: input.category || inferCategoryFromDispatchType(dispatchType),
    payload: payloadCheck.payload,
    status: 'PENDING',
    pushStatus: 'PENDING',
    smsStatus: 'PENDING',
    emailStatus: 'PENDING',
    failureClassification: 'NONE',
    attemptCount: 0,
    maxAttempts,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextAttemptAt: nowIso,
    lastError: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    dispatchedAt: null,
  };

  return { valid: true, outboxId, record };
}

export function buildNotificationOutboxRecord(input: CreateOutboxRecordInput): NotificationOutboxRecord {
  const prepared = prepareNotificationOutboxRecord(input);
  if ('error' in prepared) {
    throw new Error(prepared.error);
  }
  return prepared.record;
}

export interface PreparedNotificationOutboxBatchItem {
  outboxId: string;
  docRef: DocumentReference;
  record: NotificationOutboxRecord;
  alreadyExists: boolean;
  existingRecord?: NotificationOutboxRecord;
}

export interface PreparedNotificationOutboxBatch {
  readyItems: PreparedNotificationOutboxBatchItem[];
  invalidItems: InvalidPreparedNotificationOutboxItem[];
}

export interface WrittenOutboxBatchResult {
  writtenIds: string[];
  skippedExistingIds: string[];
  invalidItems: InvalidPreparedNotificationOutboxItem[];
  records: NotificationOutboxRecord[];
}

/**
 * Transaction Read Phase Helper (READ-ONLY — performs zero Firestore writes).
 * Validates/prepares all inputs without throwing, deduplicates identical outbox IDs within the
 * batch, and executes all `tx.get(docRef)` existence checks concurrently BEFORE any `tx.set()`.
 * Safe for multi-event transactions such as C2C MONEY_SENT + MONEY_RECEIVED.
 */
export async function prepareNotificationOutboxBatch(
  tx: FirestoreTransaction,
  fs: Firestore,
  inputs: readonly (CreateOutboxRecordInput | PrepareNotificationOutboxResult)[]
): Promise<PreparedNotificationOutboxBatch> {
  const invalidItems: InvalidPreparedNotificationOutboxItem[] = [];
  const validByOutboxId = new Map<string, PreparedNotificationOutboxItem>();

  for (const item of inputs) {
    const prepared: PrepareNotificationOutboxResult =
      item && typeof item === 'object' && 'valid' in item
        ? item
        : prepareNotificationOutboxRecord(item as CreateOutboxRecordInput);

    if ('error' in prepared) {
      invalidItems.push(prepared);
      continue;
    }

    if (!validByOutboxId.has(prepared.outboxId)) {
      validByOutboxId.set(prepared.outboxId, prepared);
    }
  }

  const dedupedValid = Array.from(validByOutboxId.values());
  const docRefs = dedupedValid.map((item) =>
    fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(item.outboxId)
  );

  // Execute ALL reads concurrently during the transaction's read phase (zero writes here)
  const snaps = docRefs.length > 0 ? await Promise.all(docRefs.map((ref) => tx.get(ref))) : [];

  const readyItems: PreparedNotificationOutboxBatchItem[] = dedupedValid.map((item, idx) => {
    const snap = snaps[idx];
    const exists = Boolean(snap?.exists);
    const existingData = exists ? (snap.data() as NotificationOutboxRecord) : undefined;
    return {
      outboxId: item.outboxId,
      docRef: docRefs[idx],
      record: existingData || item.record,
      alreadyExists: exists,
      ...(existingData ? { existingRecord: existingData } : {}),
    };
  });

  return { readyItems, invalidItems };
}

/**
 * Transaction Write Phase Helper (WRITE-ONLY — performs zero `tx.get()` reads).
 * Writes prepared new outbox records in the caller's existing Firestore transaction while
 * preserving any already-existing/completed outbox documents untouched.
 */
export function writePreparedNotificationOutboxBatchInTransaction(
  tx: FirestoreTransaction,
  batch: PreparedNotificationOutboxBatch
): WrittenOutboxBatchResult {
  const writtenIds: string[] = [];
  const skippedExistingIds: string[] = [];
  const records: NotificationOutboxRecord[] = [];

  for (const item of batch.readyItems) {
    if (item.alreadyExists) {
      skippedExistingIds.push(item.outboxId);
      records.push(item.existingRecord || item.record);
      continue;
    }
    tx.set(item.docRef, item.record);
    writtenIds.push(item.outboxId);
    records.push(item.record);
  }

  return {
    writtenIds,
    skippedExistingIds,
    invalidItems: batch.invalidItems,
    records,
  };
}

export interface ClaimOutboxLeaseResult {
  claimed: boolean;
  reason?:
    | 'NOT_FOUND'
    | 'ALREADY_TERMINAL'
    | 'LEASE_ACTIVE'
    | 'RETRY_NOT_DUE'
    | 'MAX_ATTEMPTS_EXCEEDED';
  leaseToken?: string;
  record?: NotificationOutboxRecord;
}

/**
 * Atomically claims an outbox entry for processing with an unpredictable cryptographic leaseToken.
 * Independently enforces inside the transaction:
 * - Terminal states (DISPATCHED / DEAD_LETTER) cannot be claimed.
 * - Records already at maxAttempts cannot be claimed for another attempt.
 * - FAILED_RETRYABLE records cannot be claimed before nextAttemptAt.
 * - Active unexpired PROCESSING leases cannot be stolen; expired PROCESSING leases can be reclaimed.
 */
export async function claimOutboxLease(
  fs: Firestore,
  outboxId: string,
  workerId: string,
  leaseDurationMs: number = DEFAULT_OUTBOX_LEASE_DURATION_MS,
  nowMs: number = Date.now()
): Promise<ClaimOutboxLeaseResult> {
  const cleanWorkerId = String(workerId || '').trim();
  if (!cleanWorkerId) {
    throw new Error('workerId is required to claim an outbox lease.');
  }

  const docRef = fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxId);
  const leaseToken = generateOutboxLeaseToken();
  const nowIso = new Date(nowMs).toISOString();
  const leaseExpiresAt = new Date(nowMs + leaseDurationMs).toISOString();

  return fs.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return { claimed: false, reason: 'NOT_FOUND' };
    }

    const current = snap.data() as NotificationOutboxRecord;
    if (OUTBOX_TERMINAL_STATES.has(current.status)) {
      return { claimed: false, reason: 'ALREADY_TERMINAL', record: current };
    }

    const currentAttempts = Number(current.attemptCount || 0);
    const maxAttempts =
      typeof current.maxAttempts === 'number' && Number.isInteger(current.maxAttempts) && current.maxAttempts > 0
        ? current.maxAttempts
        : DEFAULT_OUTBOX_MAX_ATTEMPTS;

    if (current.status === 'PROCESSING') {
      const expiresMs = current.leaseExpiresAt ? Date.parse(current.leaseExpiresAt) : 0;
      if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
        return { claimed: false, reason: 'LEASE_ACTIVE', record: current };
      }
      if (currentAttempts >= maxAttempts) {
        return { claimed: false, reason: 'MAX_ATTEMPTS_EXCEEDED', record: current };
      }
    } else if (current.status === 'FAILED_RETRYABLE') {
      if (currentAttempts >= maxAttempts) {
        return { claimed: false, reason: 'MAX_ATTEMPTS_EXCEEDED', record: current };
      }
      const nextAttemptMs = current.nextAttemptAt ? Date.parse(current.nextAttemptAt) : 0;
      if (Number.isFinite(nextAttemptMs) && nextAttemptMs > nowMs) {
        return { claimed: false, reason: 'RETRY_NOT_DUE', record: current };
      }
    } else if (!isValidOutboxTransition(current.status, 'PROCESSING')) {
      return { claimed: false, reason: 'ALREADY_TERMINAL', record: current };
    } else if (currentAttempts >= maxAttempts) {
      return { claimed: false, reason: 'MAX_ATTEMPTS_EXCEEDED', record: current };
    }

    const updated: NotificationOutboxRecord = {
      ...current,
      status: 'PROCESSING',
      leaseOwner: cleanWorkerId,
      leaseToken,
      leaseExpiresAt,
      attemptCount: currentAttempts + 1,
      updatedAt: nowIso,
    };

    tx.set(docRef, updated, { merge: true });
    return { claimed: true, leaseToken, record: updated };
  });
}

export interface TransitionOutboxResult {
  status: 'UPDATED' | 'LEASE_LOST' | 'INVALID_TRANSITION';
  updated: boolean;
  record?: NotificationOutboxRecord;
}

/**
 * Strictly fenced outbox state transition.
 * Transactionally verifies status === 'PROCESSING' AND exact leaseToken match before writing.
 * If another worker claimed a newer leaseToken or already transitioned the record, returns 'LEASE_LOST'
 * without mutating the document.
 */
export async function transitionOutboxAsLeaseOwner(
  fs: Firestore,
  outboxId: string,
  expectedLeaseToken: string,
  buildPatch: (current: NotificationOutboxRecord) => {
    status: OutboxStatus;
    pushStatus?: OutboxPushStatus;
    smsStatus?: OutboxMessageChannelStatus;
    emailStatus?: OutboxMessageChannelStatus;
    failureClassification?: OutboxFailureClassification;
    nextAttemptAt?: string;
    lastError?: string | null;
    dispatchedAt?: string | null;
  },
  nowMs: number = Date.now()
): Promise<TransitionOutboxResult> {
  if (!expectedLeaseToken || typeof expectedLeaseToken !== 'string') {
    return { status: 'LEASE_LOST', updated: false };
  }

  const docRef = fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxId);
  const nowIso = new Date(nowMs).toISOString();

  return fs.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return { status: 'LEASE_LOST', updated: false };
    }

    const current = snap.data() as NotificationOutboxRecord;
    if (
      current.status !== 'PROCESSING' ||
      !current.leaseToken ||
      current.leaseToken !== expectedLeaseToken
    ) {
      return { status: 'LEASE_LOST', updated: false, record: current };
    }

    if (current.leaseExpiresAt) {
      const expMs = Date.parse(current.leaseExpiresAt);
      if (Number.isFinite(expMs) && expMs <= nowMs) {
        return { status: 'LEASE_LOST', updated: false, record: current };
      }
    }

    const patch = buildPatch(current);
    if (!isValidOutboxTransition('PROCESSING', patch.status)) {
      return { status: 'INVALID_TRANSITION', updated: false, record: current };
    }

    const releaseLease = patch.status !== 'PROCESSING';
    const nextRecord: NotificationOutboxRecord = {
      ...current,
      status: patch.status,
      pushStatus: patch.pushStatus ?? current.pushStatus,
      smsStatus: patch.smsStatus ?? current.smsStatus,
      emailStatus: patch.emailStatus ?? current.emailStatus,
      failureClassification: patch.failureClassification ?? current.failureClassification,
      nextAttemptAt: patch.nextAttemptAt ?? current.nextAttemptAt,
      lastError: patch.lastError !== undefined ? patch.lastError : current.lastError,
      dispatchedAt: patch.dispatchedAt !== undefined ? patch.dispatchedAt : current.dispatchedAt,
      leaseOwner: releaseLease ? null : current.leaseOwner,
      leaseToken: releaseLease ? null : current.leaseToken,
      leaseExpiresAt: releaseLease ? null : current.leaseExpiresAt,
      updatedAt: nowIso,
    };

    tx.set(docRef, nextRecord, { merge: true });
    return { status: 'UPDATED', updated: true, record: nextRecord };
  });
}

export interface SettleExhaustedOutboxResult {
  settled: boolean;
  reason:
    | 'SETTLED_TO_DEAD_LETTER'
    | 'ALREADY_DEAD_LETTER'
    | 'ALREADY_DISPATCHED'
    | 'NOT_FOUND'
    | 'LEASE_ACTIVE'
    | 'NOT_EXHAUSTED';
  record?: NotificationOutboxRecord;
}

/**
 * Safely and idempotently settles exhausted outbox records to `DEAD_LETTER`:
 * - Expired `PROCESSING` records where `attemptCount >= maxAttempts`
 * - `FAILED_RETRYABLE` records where `attemptCount >= maxAttempts`
 * Never settles active unexpired leases, non-exhausted records, or terminal `DISPATCHED` records,
 * and ensures settled records stop appearing in retryable/expired sweep queries.
 */
export async function settleExhaustedOutboxRecord(
  fs: Firestore,
  outboxId: string,
  options?: {
    nowMs?: number;
    reason?: string;
  }
): Promise<SettleExhaustedOutboxResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const docRef = fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(outboxId);

  return fs.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) {
      return { settled: false, reason: 'NOT_FOUND' };
    }

    const current = snap.data() as NotificationOutboxRecord;

    if (current.status === 'DEAD_LETTER') {
      return { settled: true, reason: 'ALREADY_DEAD_LETTER', record: current };
    }
    if (current.status === 'DISPATCHED') {
      return { settled: false, reason: 'ALREADY_DISPATCHED', record: current };
    }

    const currentAttempts = Number(current.attemptCount || 0);
    const maxAttempts =
      typeof current.maxAttempts === 'number' && Number.isInteger(current.maxAttempts) && current.maxAttempts > 0
        ? current.maxAttempts
        : DEFAULT_OUTBOX_MAX_ATTEMPTS;

    if (current.status === 'PROCESSING') {
      const expiresMs = current.leaseExpiresAt ? Date.parse(current.leaseExpiresAt) : 0;
      if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
        return { settled: false, reason: 'LEASE_ACTIVE', record: current };
      }
    } else if (current.status !== 'FAILED_RETRYABLE') {
      return { settled: false, reason: 'NOT_EXHAUSTED', record: current };
    }

    if (currentAttempts < maxAttempts) {
      return { settled: false, reason: 'NOT_EXHAUSTED', record: current };
    }

    if (!isValidOutboxTransition(current.status, 'DEAD_LETTER')) {
      return { settled: false, reason: 'NOT_EXHAUSTED', record: current };
    }

    const failureClassification: OutboxFailureClassification =
      current.failureClassification && current.failureClassification !== 'NONE'
        ? current.failureClassification
        : 'TRANSIENT';

    const settledRecord: NotificationOutboxRecord = {
      ...current,
      status: 'DEAD_LETTER',
      failureClassification,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      dispatchedAt: null,
      lastError:
        options?.reason ||
        current.lastError ||
        `DEAD_LETTER_EXHAUSTED: Max attempts reached (${currentAttempts}/${maxAttempts}).`,
      updatedAt: nowIso,
    };

    tx.set(docRef, settledRecord, { merge: true });
    return { settled: true, reason: 'SETTLED_TO_DEAD_LETTER', record: settledRecord };
  });
}

export function supportsMessageTemplateForDispatchType(dispatchType: DispatchEventType): boolean {
  return dispatchType === 'MONEY_RECEIVED' || dispatchType === 'MONEY_SENT' || dispatchType === 'SECURITY';
}

/**
 * Returns which channels still require execution on an outbox retry.
 * Channels already SENT, NO_ACTIVE_TOKENS, DISABLED_BY_USER, FAILED_PERMANENT, or
 * template-unsupported UNCONFIGURED_PROVIDER are NOT retried.
 */
export function getUnfinishedOutboxChannels(record: Pick<NotificationOutboxRecord, 'pushStatus' | 'smsStatus' | 'emailStatus' | 'dispatchType'>): {
  push: boolean;
  sms: boolean;
  email: boolean;
} {
  const pushTerminal = new Set<OutboxPushStatus>([
    'SENT',
    'NO_ACTIVE_TOKENS',
    'DISABLED_BY_USER',
    'FAILED_PERMANENT',
  ]);
  const msgTerminal = new Set<OutboxMessageChannelStatus>([
    'SENT',
    'DISABLED_BY_USER',
    'FAILED_PERMANENT',
  ]);
  const hasMsgTemplate = supportsMessageTemplateForDispatchType(record.dispatchType);

  return {
    push: !pushTerminal.has(record.pushStatus),
    sms:
      !msgTerminal.has(record.smsStatus) &&
      !(record.smsStatus === 'UNCONFIGURED_PROVIDER' && !hasMsgTemplate),
    email:
      !msgTerminal.has(record.emailStatus) &&
      !(record.emailStatus === 'UNCONFIGURED_PROVIDER' && !hasMsgTemplate),
  };
}

export interface PersistentDispatchLogSnapshot {
  pushStatus?: string;
  smsStatus?: string;
  emailStatus?: string;
}

export interface EvaluatedOutboxOutcome {
  action: 'TRANSITION' | 'ABORT_LEASE_LOST';
  nextStatus?: OutboxStatus;
  pushStatus?: OutboxPushStatus;
  smsStatus?: OutboxMessageChannelStatus;
  emailStatus?: OutboxMessageChannelStatus;
  failureClassification?: OutboxFailureClassification;
  nextAttemptAt?: string;
  lastError?: string | null;
  dispatchedAt?: string | null;
}

/**
 * Evaluates a dispatch attempt against the existing outbox record and persistent
 * `notification_dispatch_logs` record to compute safe per-channel & outbox transitions.
 * - Preserves already-SENT channels permanently across unrelated channel failures.
 * - Treats DUPLICATE_IGNORED as completed ONLY when confirmed by persistent record.
 * - Treats NO_ACTIVE_TOKENS & DISABLED_BY_USER as terminal (non-retryable).
 * - Distinguishes UNCONFIGURED_PROVIDER from FAILED_PERMANENT invalid payloads.
 */
export function evaluateOutboxAttemptOutcome(params: {
  outboxRecord: NotificationOutboxRecord;
  dispatchResult?: DispatchResultSummary;
  persistentLog?: PersistentDispatchLogSnapshot | null;
  payloadValidationError?: string;
  persistenceError?: string;
  channelPolicy?: {
    requireConfiguredSms?: boolean;
    requireConfiguredEmail?: boolean;
  };
  nowMs?: number;
}): EvaluatedOutboxOutcome {
  const { outboxRecord, dispatchResult, persistentLog, payloadValidationError, persistenceError, channelPolicy } = params;
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  if (OUTBOX_TERMINAL_STATES.has(outboxRecord.status)) {
    return { action: 'ABORT_LEASE_LOST' };
  }

  if (payloadValidationError) {
    return {
      action: 'TRANSITION',
      nextStatus: 'DEAD_LETTER',
      pushStatus: outboxRecord.pushStatus === 'SENT' ? 'SENT' : 'FAILED_PERMANENT',
      smsStatus: outboxRecord.smsStatus === 'SENT' ? 'SENT' : 'FAILED_PERMANENT',
      emailStatus: outboxRecord.emailStatus === 'SENT' ? 'SENT' : 'FAILED_PERMANENT',
      failureClassification: 'PERMANENT_INVALID_PAYLOAD',
      lastError: payloadValidationError,
      dispatchedAt: null,
    };
  }

  if (
    dispatchResult?.push?.status === 'LEASE_LOST' ||
    dispatchResult?.sms?.status === 'LEASE_LOST' ||
    dispatchResult?.email?.status === 'LEASE_LOST'
  ) {
    return { action: 'ABORT_LEASE_LOST' };
  }

  // 1. Resolve next Push Status (never downgrade SENT, NO_ACTIVE_TOKENS, DISABLED_BY_USER, FAILED_PERMANENT)
  let nextPushStatus: OutboxPushStatus = outboxRecord.pushStatus;
  if (
    outboxRecord.pushStatus !== 'SENT' &&
    outboxRecord.pushStatus !== 'NO_ACTIVE_TOKENS' &&
    outboxRecord.pushStatus !== 'DISABLED_BY_USER' &&
    outboxRecord.pushStatus !== 'FAILED_PERMANENT'
  ) {
    const rawPushStatus = dispatchResult?.push?.status;
    if (rawPushStatus === 'SKIPPED') {
      // Intentionally excluded by caller channel filter: preserve existing persisted pushStatus untouched
      nextPushStatus = outboxRecord.pushStatus;
    } else if (rawPushStatus === 'SENT') {
      nextPushStatus = 'SENT';
    } else if (rawPushStatus === 'NO_ACTIVE_TOKENS') {
      nextPushStatus = 'NO_ACTIVE_TOKENS';
    } else if (rawPushStatus === 'DISABLED_BY_USER') {
      nextPushStatus = 'DISABLED_BY_USER';
    } else if (rawPushStatus === 'DUPLICATE_IGNORED') {
      if (persistentLog?.pushStatus === 'SENT') {
        nextPushStatus = 'SENT';
      } else if (persistentLog?.pushStatus === 'NO_ACTIVE_TOKENS') {
        nextPushStatus = 'NO_ACTIVE_TOKENS';
      } else {
        // Unconfirmed DUPLICATE_IGNORED cannot be assumed delivered
        nextPushStatus = 'FAILED_RETRYABLE';
      }
    } else if (rawPushStatus === 'PARTIAL') {
      nextPushStatus = 'PARTIAL';
    } else if (rawPushStatus === 'UNCONFIGURED_PROVIDER') {
      nextPushStatus = 'UNCONFIGURED_PROVIDER';
    } else if (rawPushStatus === 'DUPLICATE_IN_FLIGHT' || rawPushStatus === 'LEASE_ERROR' || rawPushStatus === 'FAILED') {
      nextPushStatus = 'FAILED_RETRYABLE';
    }
  }

  // 2. Resolve next SMS Status (never downgrade SENT, DISABLED_BY_USER, FAILED_PERMANENT)
  let nextSmsStatus: OutboxMessageChannelStatus = outboxRecord.smsStatus;
  if (
    outboxRecord.smsStatus !== 'SENT' &&
    outboxRecord.smsStatus !== 'DISABLED_BY_USER' &&
    outboxRecord.smsStatus !== 'FAILED_PERMANENT'
  ) {
    const rawSmsStatus = dispatchResult?.sms?.status;
    if (rawSmsStatus === 'SKIPPED') {
      // Intentionally excluded by caller channel filter: preserve existing persisted smsStatus untouched
      nextSmsStatus = outboxRecord.smsStatus;
    } else if (rawSmsStatus === 'SENT') {
      nextSmsStatus = 'SENT';
    } else if (rawSmsStatus === 'DISABLED_BY_USER') {
      nextSmsStatus = 'DISABLED_BY_USER';
    } else if (rawSmsStatus === 'DUPLICATE_IGNORED') {
      nextSmsStatus = persistentLog?.smsStatus === 'SENT' ? 'SENT' : 'FAILED_RETRYABLE';
    } else if (rawSmsStatus === 'INVALID_PHONE') {
      nextSmsStatus = 'FAILED_PERMANENT';
    } else if (rawSmsStatus === 'UNCONFIGURED_PROVIDER') {
      nextSmsStatus = 'UNCONFIGURED_PROVIDER';
    } else if (rawSmsStatus === 'FAILED') {
      nextSmsStatus = 'FAILED_RETRYABLE';
    }
  }

  // 3. Resolve next Email Status (never downgrade SENT, DISABLED_BY_USER, FAILED_PERMANENT)
  let nextEmailStatus: OutboxMessageChannelStatus = outboxRecord.emailStatus;
  if (
    outboxRecord.emailStatus !== 'SENT' &&
    outboxRecord.emailStatus !== 'DISABLED_BY_USER' &&
    outboxRecord.emailStatus !== 'FAILED_PERMANENT'
  ) {
    const rawEmailStatus = dispatchResult?.email?.status;
    if (rawEmailStatus === 'SKIPPED') {
      // Intentionally excluded by caller channel filter: preserve existing persisted emailStatus untouched
      nextEmailStatus = outboxRecord.emailStatus;
    } else if (rawEmailStatus === 'SENT') {
      nextEmailStatus = 'SENT';
    } else if (rawEmailStatus === 'DISABLED_BY_USER') {
      nextEmailStatus = 'DISABLED_BY_USER';
    } else if (rawEmailStatus === 'DUPLICATE_IGNORED') {
      nextEmailStatus = persistentLog?.emailStatus === 'SENT' ? 'SENT' : 'FAILED_RETRYABLE';
    } else if (rawEmailStatus === 'INVALID_EMAIL') {
      nextEmailStatus = 'FAILED_PERMANENT';
    } else if (rawEmailStatus === 'UNCONFIGURED_PROVIDER') {
      nextEmailStatus = 'UNCONFIGURED_PROVIDER';
    } else if (rawEmailStatus === 'FAILED') {
      nextEmailStatus = 'FAILED_RETRYABLE';
    }
  }

  const supportsMsgTemplate = supportsMessageTemplateForDispatchType(outboxRecord.dispatchType);
  const smsConfigRequired = Boolean(channelPolicy?.requireConfiguredSms) && supportsMsgTemplate;
  const emailConfigRequired = Boolean(channelPolicy?.requireConfiguredEmail) && supportsMsgTemplate;

  const pushDone =
    nextPushStatus === 'SENT' ||
    nextPushStatus === 'NO_ACTIVE_TOKENS' ||
    nextPushStatus === 'DISABLED_BY_USER';

  const hasRetryableChannel =
    Boolean(persistenceError) ||
    nextPushStatus === 'PENDING' ||
    nextPushStatus === 'FAILED_RETRYABLE' ||
    nextPushStatus === 'PARTIAL' ||
    nextPushStatus === 'UNCONFIGURED_PROVIDER' ||
    nextSmsStatus === 'PENDING' ||
    nextSmsStatus === 'FAILED_RETRYABLE' ||
    nextEmailStatus === 'PENDING' ||
    nextEmailStatus === 'FAILED_RETRYABLE' ||
    (smsConfigRequired && nextSmsStatus === 'UNCONFIGURED_PROVIDER') ||
    (emailConfigRequired && nextEmailStatus === 'UNCONFIGURED_PROVIDER');

  const hasMissingConfig =
    nextPushStatus === 'UNCONFIGURED_PROVIDER' ||
    (supportsMsgTemplate &&
      (nextSmsStatus === 'UNCONFIGURED_PROVIDER' || nextEmailStatus === 'UNCONFIGURED_PROVIDER'));

  const hasPermanentFailure =
    nextPushStatus === 'FAILED_PERMANENT' ||
    nextSmsStatus === 'FAILED_PERMANENT' ||
    nextEmailStatus === 'FAILED_PERMANENT';

  const maxAttemptsReached = outboxRecord.attemptCount >= outboxRecord.maxAttempts;

  if (!hasRetryableChannel && (pushDone || nextPushStatus === 'FAILED_PERMANENT')) {
    if (nextPushStatus === 'FAILED_PERMANENT' && nextSmsStatus !== 'SENT' && nextEmailStatus !== 'SENT') {
      return {
        action: 'TRANSITION',
        nextStatus: 'DEAD_LETTER',
        pushStatus: nextPushStatus,
        smsStatus: nextSmsStatus,
        emailStatus: nextEmailStatus,
        failureClassification: 'PERMANENT_INVALID_PAYLOAD',
        lastError: 'All notification channels failed permanently.',
        dispatchedAt: null,
      };
    }

    return {
      action: 'TRANSITION',
      nextStatus: 'DISPATCHED',
      pushStatus: nextPushStatus,
      smsStatus: nextSmsStatus,
      emailStatus: nextEmailStatus,
      failureClassification: hasMissingConfig
        ? 'MISSING_CONFIGURATION'
        : hasPermanentFailure
          ? 'PERMANENT_INVALID_PAYLOAD'
          : 'NONE',
      lastError: null,
      dispatchedAt: nowIso,
    };
  }

  const classification: OutboxFailureClassification =
    hasMissingConfig && !persistenceError ? 'MISSING_CONFIGURATION' : 'TRANSIENT';

  const nextStatus: OutboxStatus = maxAttemptsReached ? 'DEAD_LETTER' : 'FAILED_RETRYABLE';
  const backoffMs = Math.min(30_000 * Math.pow(2, Math.max(0, outboxRecord.attemptCount - 1)), 3_600_000);
  const nextAttemptAt = new Date(nowMs + backoffMs).toISOString();

  return {
    action: 'TRANSITION',
    nextStatus,
    pushStatus: nextPushStatus,
    smsStatus: nextSmsStatus,
    emailStatus: nextEmailStatus,
    failureClassification: classification,
    nextAttemptAt,
    lastError: persistenceError
      ? `PERSISTENCE_ERROR: ${persistenceError}`
      : nextPushStatus === 'UNCONFIGURED_PROVIDER'
        ? 'UNCONFIGURED_PROVIDER: Push messaging provider is not configured.'
        : (smsConfigRequired && nextSmsStatus === 'UNCONFIGURED_PROVIDER') ||
            (emailConfigRequired && nextEmailStatus === 'UNCONFIGURED_PROVIDER')
          ? `UNCONFIGURED_PROVIDER: Required message provider is not configured (sms=${nextSmsStatus}, email=${nextEmailStatus}).`
          : `Channel retry required (push=${nextPushStatus}, sms=${nextSmsStatus}, email=${nextEmailStatus}).`,
    dispatchedAt: null,
  };
}

/**
 * Builds a DispatchNotificationEvent from a claimed outbox record for Stage 3D-B workers.
 * Preserves the original ledger transactionId AND supplies the explicit lifecycle eventKey.
 */
export function buildDispatchEventFromOutboxRecord(
  record: NotificationOutboxRecord,
  contact?: { email?: string; phone?: string }
): DispatchNotificationEvent {
  return {
    transactionId: record.transactionId,
    referenceNumber: record.referenceNumber,
    eventKey: record.eventKey,
    lifecycleStage: record.lifecycleStage === 'COMPLETED' ? undefined : record.lifecycleStage,
    type: record.dispatchType,
    category: record.category,
    userId: record.userId,
    title: record.payload.title,
    body: record.payload.body,
    actionUrl: record.payload.actionUrl,
    amount: record.payload.amount,
    currency: record.payload.currency,
    senderName: record.payload.senderName,
    recipientName: record.payload.recipientName,
    accountMasked: record.payload.accountMasked,
    recipientEmail: contact?.email,
    recipientPhone: contact?.phone,
  };
}

/**
 * Builds outbox-owned dispatch execution options linking active lease fencing,
 * unfinished channel selection, and required persistent completion tracking.
 */
export function buildOutboxDispatchOptions(
  record: Pick<NotificationOutboxRecord, 'id' | 'pushStatus' | 'smsStatus' | 'emailStatus' | 'dispatchType'>,
  leaseToken: string,
  overrides?: {
    nowMs?: number;
    requirePersistentTracking?: boolean;
  }
): DispatchExecutionOptions {
  return {
    outboxContext: {
      outboxId: record.id,
      leaseToken,
      outboxCollection: NOTIFICATION_OUTBOX_COLLECTION,
      channels: getUnfinishedOutboxChannels(record),
      knownChannelStatuses: {
        pushStatus: record.pushStatus,
        smsStatus: record.smsStatus,
        emailStatus: record.emailStatus,
      },
      requirePersistentTracking: overrides?.requirePersistentTracking ?? true,
      ...(overrides?.nowMs !== undefined ? { nowMs: overrides.nowMs } : {}),
    },
    requirePersistentTracking: overrides?.requirePersistentTracking ?? true,
  };
}

/**
 * Helper to fetch the persistent `notification_dispatch_logs` record corresponding to an outbox entry.
 */
export async function fetchDispatchLogForOutboxRecord(
  fs: Firestore,
  record: Pick<NotificationOutboxRecord, 'userId' | 'transactionId' | 'referenceNumber' | 'eventKey' | 'dispatchType'>
): Promise<PersistentDispatchLogSnapshot | null> {
  const dispatchKey = resolveDispatchKey({
    transactionId: record.transactionId,
    referenceNumber: record.referenceNumber,
    eventKey: record.eventKey,
    type: record.dispatchType,
  });
  const docId = computeDispatchLogId(record.userId, dispatchKey);
  const snap = await fs.collection('notification_dispatch_logs').doc(docId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    pushStatus: typeof data.pushStatus === 'string' ? data.pushStatus : undefined,
    smsStatus: typeof data.smsStatus === 'string' ? data.smsStatus : undefined,
    emailStatus: typeof data.emailStatus === 'string' ? data.emailStatus : undefined,
  };
}

/**
 * Composite-indexed query for claimable PENDING and FAILED_RETRYABLE outbox items.
 * Backed by composite index: (status ASC, nextAttemptAt ASC).
 */
export function buildRetryableOutboxQuery(
  fs: Firestore,
  nowIso: string = new Date().toISOString(),
  limitCount: number = 50
): Query {
  return fs
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .where('status', 'in', ['PENDING', 'FAILED_RETRYABLE'])
    .where('nextAttemptAt', '<=', nowIso)
    .orderBy('nextAttemptAt', 'asc')
    .limit(limitCount);
}

/**
 * Composite-indexed query for expired PROCESSING outbox leases.
 * Backed by composite index: (status ASC, leaseExpiresAt ASC).
 */
export function buildExpiredProcessingOutboxQuery(
  fs: Firestore,
  nowIso: string = new Date().toISOString(),
  limitCount: number = 50
): Query {
  return fs
    .collection(NOTIFICATION_OUTBOX_COLLECTION)
    .where('status', '==', 'PROCESSING')
    .where('leaseExpiresAt', '<=', nowIso)
    .orderBy('leaseExpiresAt', 'asc')
    .limit(limitCount);
}
