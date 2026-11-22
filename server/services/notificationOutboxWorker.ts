// Monvera Digital Banking — Stage 3D-C1 Durable Notification Outbox Worker
// Default-OFF, Railway-only bounded polling worker with strict timestamp cutoff,
// two-account C2C allowlist enforcement, durable anti-starvation cursor checkpointing,
// transactional lease fencing, and outbound kill-switch protection.

import crypto from 'crypto';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { adminFirestore, isFirebaseAdminConfigured } from '../firebaseAdmin';
import {
  DEFAULT_OUTBOX_LEASE_DURATION_MS,
  DEFAULT_OUTBOX_MAX_ATTEMPTS,
  NOTIFICATION_OUTBOX_COLLECTION,
  type NotificationOutboxRecord,
  type OutboxChannelRequirementPolicy,
  buildDispatchEventFromOutboxRecord,
  buildExpiredProcessingOutboxQuery,
  buildOutboxDispatchOptions,
  buildRetryableOutboxQuery,
  claimOutboxLease,
  evaluateOutboxAttemptOutcome,
  fetchDispatchLogForOutboxRecord,
  parseValidOutboxTimestampMs,
  settleExhaustedOutboxRecord,
  transitionOutboxAsLeaseOwner,
} from './notificationOutbox';
import {
  type DispatchExecutionOptions,
  type DispatchResultSummary,
  isOutboundNotificationsDisabled,
  isUidAllowlisted,
  resolveNotificationAllowlistPolicy,
  serverNotificationDispatcher,
} from './notificationDispatcher';

export const NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION = 'notification_outbox_worker_state';
export const DEFAULT_WORKER_PAGE_SIZE = 50;
export const DEFAULT_WORKER_MAX_PAGES_PER_TICK = 10;
export const DEFAULT_WORKER_ELIGIBLE_BATCH_LIMIT = 20;
export const DEFAULT_WORKER_POLL_INTERVAL_MS = 15_000;

export type WorkerTickSkippedReason =
  | 'WORKER_DISABLED'
  | 'VERCEL_SERVERLESS_BLOCKED'
  | 'OUTBOUND_NOTIFICATIONS_DISABLED'
  | 'FIREBASE_ADMIN_NOT_CONFIGURED'
  | 'INVALID_OR_MISSING_MIN_CREATED_AT'
  | 'ALLOWLIST_REQUIRED_OR_INVALID'
  | 'CHECKPOINT_LOAD_FAILED'
  | 'TICK_ALREADY_IN_PROGRESS';

export interface NotificationOutboxWorkerCheckpointCursor {
  docId: string;
  sortValue: string;
}

export interface NotificationOutboxWorkerCheckpointDoc {
  checkpointId: string;
  configScopeHash: string;
  minCreatedAtIso: string;
  retryableCursor: NotificationOutboxWorkerCheckpointCursor | null;
  expiredCursor: NotificationOutboxWorkerCheckpointCursor | null;
  updatedAt: string;
}

export interface NotificationOutboxWorkerDependencies {
  firestore?: Firestore;
  isAdminConfigured?: () => boolean;
  dispatcher?: {
    dispatch: (
      event: ReturnType<typeof buildDispatchEventFromOutboxRecord>,
      options?: DispatchExecutionOptions
    ) => Promise<DispatchResultSummary>;
  };
  resolveCustomerContact?: (
    userId: string
  ) => Promise<{ email?: string; phone?: string }>;
  nowFn?: () => number;
  workerId?: string;
  checkpointId?: string;
  pageSize?: number;
  maxPagesPerTick?: number;
  eligibleBatchLimit?: number;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
  minCreatedAt?: string;
  allowlistUidsRaw?: string;
  allowlistModeRaw?: string;
  channelPolicy?: {
    requireConfiguredSms?: boolean;
    requireConfiguredEmail?: boolean;
  };
}

export interface NotificationOutboxWorkerTickSummary {
  executed: boolean;
  skippedReason?: WorkerTickSkippedReason;
  scannedRetryable: number;
  scannedExpired: number;
  skippedHistoricalOrInvalid: number;
  skippedNotAllowlisted: number;
  claimedCount: number;
  dispatchedCount: number;
  retryScheduledCount: number;
  deadLetteredCount: number;
  leaseLostCount: number;
  wrappedRetryableScan: boolean;
  wrappedExpiredScan: boolean;
}

interface C2CPairCheckResult {
  eligible: boolean;
  reason?: string;
}

function isVercelEnvironment(): boolean {
  const val = String(process.env.VERCEL || '').trim().toLowerCase();
  return val === '1' || val === 'true';
}

export function isNotificationWorkerEnabled(): boolean {
  return process.env.NOTIFICATION_WORKER_ENABLED === 'true';
}

function isWorkerEnabledEnv(): boolean {
  return isNotificationWorkerEnabled();
}

function computeConfigScopeHash(minCreatedAtIso: string, allowlist: Set<string> | null): string {
  const allowlistList = allowlist ? Array.from(allowlist).sort() : [];
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ minCreatedAtIso, allowlist: allowlistList }))
    .digest('hex')
    .slice(0, 24);
}

function isC2CTransactionData(txData: Record<string, any> | undefined): boolean {
  if (!txData || typeof txData !== 'object') return false;
  if (String(txData.type || '').toUpperCase() !== 'TRANSFER') return false;
  const meta = txData.metadata && typeof txData.metadata === 'object' ? txData.metadata : {};
  if (meta.isInternalTransfer === true) return false;
  if (meta.transferScope === 'INTERNAL_ACCOUNT_TRANSFER') return false;
  if (meta.disbursementType === 'ADMINISTRATIVE_TRANSFER') return false;
  return true;
}

export class NotificationOutboxWorker {
  private readonly deps: NotificationOutboxWorkerDependencies;
  private readonly instanceWorkerId: string;
  private readonly checkpointId: string;
  private isTickRunning = false;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private isStarted = false;

  private retryableCursorDoc: any = null;
  private expiredCursorDoc: any = null;
  private loadedConfigScopeHash: string | null = null;

  constructor(deps: NotificationOutboxWorkerDependencies = {}) {
    this.deps = deps;
    this.instanceWorkerId =
      deps.workerId || `outbox_wrk_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
    this.checkpointId = String(deps.checkpointId || 'default_outbox_worker').trim() || 'default_outbox_worker';
  }

  public isRunning(): boolean {
    return this.isStarted;
  }

  public isTickInFlight(): boolean {
    return this.isTickRunning;
  }

  private getNowMs(): number {
    return this.deps.nowFn ? this.deps.nowFn() : Date.now();
  }

  private getFirestore(): Firestore | null {
    if (this.deps.firestore) return this.deps.firestore;
    const configured = this.deps.isAdminConfigured
      ? this.deps.isAdminConfigured()
      : isFirebaseAdminConfigured();
    return configured ? adminFirestore : null;
  }

  private async resolveContact(fs: Firestore, userId: string): Promise<{ email?: string; phone?: string }> {
    if (this.deps.resolveCustomerContact) {
      return this.deps.resolveCustomerContact(userId);
    }
    try {
      const snap = await fs.collection('users').doc(userId).get();
      if (!snap.exists) return {};
      const data = snap.data() || {};
      const email = typeof data.email === 'string' && data.email.trim() ? data.email.trim() : undefined;
      const rawPhone =
        typeof data.phone === 'string' && data.phone.trim()
          ? data.phone.trim()
          : typeof data.phoneNumber === 'string' && data.phoneNumber.trim()
            ? data.phoneNumber.trim()
            : undefined;
      return { email, phone: rawPhone };
    } catch {
      return {};
    }
  }

  /**
   * Enforces strict two-account C2C allowlist rules when NOTIFICATION_ALLOWLIST_UIDS is configured.
   * For any C2C transfer notification (MONEY_SENT or MONEY_RECEIVED belonging to a C2C TRANSFER),
   * verifies BOTH senderUserId and recipientUserId are explicitly allowlisted before claiming.
   * Rejects the entire pair if either party is unapproved or unverifiable.
   * Does not log or copy account numbers or sensitive customer details.
   */
  private async checkC2CPairEligibility(
    fs: Firestore,
    record: NotificationOutboxRecord,
    allowlist: Set<string> | null
  ): Promise<C2CPairCheckResult> {
    if (!isUidAllowlisted(record.userId, allowlist)) {
      return { eligible: false, reason: 'USER_NOT_ALLOWLISTED' };
    }

    if (!allowlist) {
      return { eligible: true };
    }

    if (record.dispatchType !== 'MONEY_SENT' && record.dispatchType !== 'MONEY_RECEIVED') {
      return { eligible: true };
    }

    const txId = String(record.transactionId || '').trim();
    if (!txId) {
      return { eligible: false, reason: 'MISSING_TRANSACTION_ID_FOR_C2C_CHECK' };
    }

    try {
      const txSnap = await fs.collection('transactions').doc(txId).get();
      if (!txSnap.exists) {
        // MONEY_SENT only exists for C2C transfers; MONEY_RECEIVED could be C2C too — fail closed if missing under allowlist mode
        return { eligible: false, reason: 'TRANSACTION_NOT_FOUND_FOR_ALLOWLIST_CHECK' };
      }

      const txData = txSnap.data() || {};
      if (!isC2CTransactionData(txData)) {
        return { eligible: true };
      }

      const senderUid = typeof txData.senderUserId === 'string' ? txData.senderUserId.trim() : '';
      const recipientUid = typeof txData.recipientUserId === 'string' ? txData.recipientUserId.trim() : '';
      if (!senderUid || !recipientUid) {
        return { eligible: false, reason: 'INCOMPLETE_C2C_PARTICIPANTS' };
      }

      if (record.userId !== senderUid && record.userId !== recipientUid) {
        return { eligible: false, reason: 'OUTBOX_USER_NOT_TX_PARTICIPANT' };
      }

      if (!isUidAllowlisted(senderUid, allowlist) || !isUidAllowlisted(recipientUid, allowlist)) {
        return { eligible: false, reason: 'C2C_PAIR_NOT_BOTH_ALLOWLISTED' };
      }

      return { eligible: true };
    } catch {
      return { eligible: false, reason: 'C2C_VERIFICATION_READ_FAILED' };
    }
  }

  private validateRecordTimestampAndAllowlist(
    record: NotificationOutboxRecord,
    minCreatedAtMs: number,
    allowlist: Set<string> | null
  ): { eligible: boolean; reason?: string } {
    const createdAtMs = parseValidOutboxTimestampMs(record?.createdAt);
    if (createdAtMs === null) {
      return { eligible: false, reason: 'MISSING_OR_INVALID_CREATED_AT' };
    }
    if (createdAtMs < minCreatedAtMs) {
      return { eligible: false, reason: 'HISTORICAL_BEFORE_CUTOFF' };
    }
    if (!isUidAllowlisted(record?.userId, allowlist)) {
      return { eligible: false, reason: 'USER_NOT_ALLOWLISTED' };
    }
    return { eligible: true };
  }

  private parseSavedCursor(raw: unknown): NotificationOutboxWorkerCheckpointCursor | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const candidate = raw as Record<string, unknown>;
    const docId = typeof candidate.docId === 'string' ? candidate.docId.trim() : '';
    const sortValue = typeof candidate.sortValue === 'string' ? candidate.sortValue.trim() : '';
    if (!docId || !sortValue) {
      return null;
    }
    return { docId, sortValue };
  }

  private async resolveCheckpointCursor(
    fs: Firestore,
    saved: NotificationOutboxWorkerCheckpointCursor | null | undefined,
    expectedStatuses: readonly string[],
    sortField: 'nextAttemptAt' | 'leaseExpiresAt'
  ): Promise<any> {
    if (!saved || !saved.docId || !saved.sortValue) {
      return null;
    }
    if (saved.docId === '__sort_only__') {
      return saved.sortValue;
    }
    // Allow transient Firestore read failures to propagate so loadCheckpointsIfNeeded can retry next tick
    const snap = await fs.collection(NOTIFICATION_OUTBOX_COLLECTION).doc(saved.docId).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (
        expectedStatuses.includes(String(data.status || '')) &&
        data[sortField] === saved.sortValue
      ) {
        return snap;
      }
    }
    return saved.sortValue;
  }

  private async loadCheckpointsIfNeeded(
    fs: Firestore,
    configScopeHash: string
  ): Promise<boolean> {
    if (this.loadedConfigScopeHash === configScopeHash) {
      return true;
    }

    try {
      const snap = await fs
        .collection(NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION)
        .doc(this.checkpointId)
        .get();
      if (!snap.exists) {
        this.retryableCursorDoc = null;
        this.expiredCursorDoc = null;
        this.loadedConfigScopeHash = configScopeHash;
        return true;
      }
      const data = snap.data() as NotificationOutboxWorkerCheckpointDoc | undefined;
      if (!data || data.configScopeHash !== configScopeHash) {
        this.retryableCursorDoc = null;
        this.expiredCursorDoc = null;
        this.loadedConfigScopeHash = configScopeHash;
        return true;
      }

      const savedRetryable = this.parseSavedCursor(data.retryableCursor);
      const savedExpired = this.parseSavedCursor(data.expiredCursor);

      const resolvedRetryable = await this.resolveCheckpointCursor(
        fs,
        savedRetryable,
        ['PENDING', 'FAILED_RETRYABLE'],
        'nextAttemptAt'
      );
      const resolvedExpired = await this.resolveCheckpointCursor(
        fs,
        savedExpired,
        ['PROCESSING'],
        'leaseExpiresAt'
      );

      this.retryableCursorDoc = resolvedRetryable;
      this.expiredCursorDoc = resolvedExpired;
      this.loadedConfigScopeHash = configScopeHash;
      return true;
    } catch (err: any) {
      console.warn(
        '[OutboxWorker] Transient failure loading scan checkpoint; retaining unloaded state for retry:',
        err?.message || 'Firestore read error'
      );
      return false;
    }
  }

  private extractCheckpointCursor(
    cursorDoc: any,
    sortField: 'nextAttemptAt' | 'leaseExpiresAt'
  ): NotificationOutboxWorkerCheckpointCursor | null {
    if (!cursorDoc) return null;
    if (typeof cursorDoc === 'string') {
      return cursorDoc ? { docId: '__sort_only__', sortValue: cursorDoc } : null;
    }
    const docId = typeof cursorDoc.id === 'string' ? cursorDoc.id : '';
    const data = typeof cursorDoc.data === 'function' ? cursorDoc.data() : undefined;
    const sortValue = data && typeof data[sortField] === 'string' ? data[sortField] : '';
    if (!docId || !sortValue) return null;
    return { docId, sortValue };
  }

  private async saveCheckpoints(
    fs: Firestore,
    configScopeHash: string,
    minCreatedAtIso: string,
    nowIso: string
  ): Promise<void> {
    if (this.loadedConfigScopeHash !== configScopeHash) {
      return;
    }
    try {
      const payload: NotificationOutboxWorkerCheckpointDoc = {
        checkpointId: this.checkpointId,
        configScopeHash,
        minCreatedAtIso,
        retryableCursor: this.extractCheckpointCursor(this.retryableCursorDoc, 'nextAttemptAt'),
        expiredCursor: this.extractCheckpointCursor(this.expiredCursorDoc, 'leaseExpiresAt'),
        updatedAt: nowIso,
      };
      await fs
        .collection(NOTIFICATION_OUTBOX_WORKER_STATE_COLLECTION)
        .doc(this.checkpointId)
        .set(payload, { merge: true });
    } catch (err: any) {
      console.warn('[OutboxWorker] Failed to persist scan checkpoint:', err?.message || err);
    }
  }

  private async processClaimedRecord(
    fs: Firestore,
    claimedRecord: NotificationOutboxRecord,
    leaseToken: string,
    allowlist: Set<string> | null,
    summary: NotificationOutboxWorkerTickSummary
  ): Promise<void> {
    if (isOutboundNotificationsDisabled()) {
      return;
    }

    const dispatcher = this.deps.dispatcher || serverNotificationDispatcher;
    const contact = await this.resolveContact(fs, claimedRecord.userId);
    const dispatchEvent = buildDispatchEventFromOutboxRecord(claimedRecord, contact);
    const dispatchOptions = buildOutboxDispatchOptions(claimedRecord, leaseToken, {
      nowMs: this.getNowMs(),
      requirePersistentTracking: true,
    });

    dispatchOptions.allowlistUids = allowlist;
    dispatchOptions.disableOutbound = isOutboundNotificationsDisabled();

    let dispatchResult: DispatchResultSummary | undefined;
    let persistenceError: string | undefined;

    try {
      dispatchResult = await dispatcher.dispatch(dispatchEvent, dispatchOptions);
    } catch (err: any) {
      persistenceError = err?.message || 'Dispatcher execution error';
    }

    // Re-check outbound kill switch before evaluating/mutating if activated mid-flight
    if (isOutboundNotificationsDisabled()) {
      return;
    }

    const persistentLog = await fetchDispatchLogForOutboxRecord(fs, claimedRecord).catch(() => null);
    const evaluated = evaluateOutboxAttemptOutcome({
      outboxRecord: claimedRecord,
      dispatchResult,
      persistentLog,
      persistenceError,
      channelPolicy: this.deps.channelPolicy,
      nowMs: this.getNowMs(),
    });

    if (evaluated.action === 'ABORT_LEASE_LOST' || !evaluated.nextStatus) {
      summary.leaseLostCount++;
      return;
    }

    const transitionResult = await transitionOutboxAsLeaseOwner(
      fs,
      claimedRecord.id,
      leaseToken,
      () => ({
        status: evaluated.nextStatus!,
        pushStatus: evaluated.pushStatus,
        smsStatus: evaluated.smsStatus,
        emailStatus: evaluated.emailStatus,
        failureClassification: evaluated.failureClassification,
        nextAttemptAt: evaluated.nextAttemptAt,
        lastError: evaluated.lastError,
        dispatchedAt: evaluated.dispatchedAt,
      }),
      this.getNowMs()
    );

    if (transitionResult.status === 'LEASE_LOST') {
      summary.leaseLostCount++;
      return;
    }

    if (transitionResult.updated) {
      if (evaluated.nextStatus === 'DISPATCHED') {
        summary.dispatchedCount++;
      } else if (evaluated.nextStatus === 'DEAD_LETTER') {
        summary.deadLetteredCount++;
      } else if (evaluated.nextStatus === 'FAILED_RETRYABLE') {
        summary.retryScheduledCount++;
      }
    }
  }

  public async runTick(): Promise<NotificationOutboxWorkerTickSummary> {
    const emptySummary = (skippedReason?: WorkerTickSkippedReason): NotificationOutboxWorkerTickSummary => ({
      executed: false,
      ...(skippedReason ? { skippedReason } : {}),
      scannedRetryable: 0,
      scannedExpired: 0,
      skippedHistoricalOrInvalid: 0,
      skippedNotAllowlisted: 0,
      claimedCount: 0,
      dispatchedCount: 0,
      retryScheduledCount: 0,
      deadLetteredCount: 0,
      leaseLostCount: 0,
      wrappedRetryableScan: false,
      wrappedExpiredScan: false,
    });

    if (isVercelEnvironment()) {
      return emptySummary('VERCEL_SERVERLESS_BLOCKED');
    }
    if (!isWorkerEnabledEnv()) {
      return emptySummary('WORKER_DISABLED');
    }
    if (isOutboundNotificationsDisabled()) {
      return emptySummary('OUTBOUND_NOTIFICATIONS_DISABLED');
    }

    const rawMinCreatedAt =
      this.deps.minCreatedAt !== undefined
        ? this.deps.minCreatedAt
        : process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT;
    const minCreatedAtMs = parseValidOutboxTimestampMs(rawMinCreatedAt);
    if (minCreatedAtMs === null) {
      return emptySummary('INVALID_OR_MISSING_MIN_CREATED_AT');
    }
    const minCreatedAtIso = new Date(minCreatedAtMs).toISOString();

    const allowlistPolicy = resolveNotificationAllowlistPolicy({
      allowlistUidsRaw: this.deps.allowlistUidsRaw,
      allowlistModeRaw: this.deps.allowlistModeRaw,
      requireRestrictedOrExplicitOpen: true,
    });
    if (!allowlistPolicy.allowed) {
      console.warn(
        '[OutboxWorker] Tick aborted: NOTIFICATION_ALLOWLIST_UIDS must contain at least one valid UID unless NOTIFICATION_ALLOWLIST_MODE=OPEN.'
      );
      return emptySummary('ALLOWLIST_REQUIRED_OR_INVALID');
    }
    const allowlist = allowlistPolicy.allowlist;

    const fs = this.getFirestore();
    if (!fs) {
      return emptySummary('FIREBASE_ADMIN_NOT_CONFIGURED');
    }

    if (this.isTickRunning) {
      return emptySummary('TICK_ALREADY_IN_PROGRESS');
    }

    this.isTickRunning = true;
    const summary: NotificationOutboxWorkerTickSummary = {
      ...emptySummary(),
      executed: true,
    };

    try {
      const configScopeHash = computeConfigScopeHash(minCreatedAtIso, allowlist);
      const checkpointsLoaded = await this.loadCheckpointsIfNeeded(fs, configScopeHash);
      if (!checkpointsLoaded) {
        return emptySummary('CHECKPOINT_LOAD_FAILED');
      }

      const pageSize = Math.max(1, Math.min(200, this.deps.pageSize ?? DEFAULT_WORKER_PAGE_SIZE));
      const maxPagesPerTick = Math.max(
        1,
        Math.min(50, this.deps.maxPagesPerTick ?? DEFAULT_WORKER_MAX_PAGES_PER_TICK)
      );
      const eligibleBatchLimit = Math.max(
        1,
        Math.min(100, this.deps.eligibleBatchLimit ?? DEFAULT_WORKER_ELIGIBLE_BATCH_LIMIT)
      );
      const leaseDurationMs = this.deps.leaseDurationMs ?? DEFAULT_OUTBOX_LEASE_DURATION_MS;

      let processedEligible = 0;

      // 1. Bounded cursor scan for expired PROCESSING leases (reclaim or settle exhausted to DEAD_LETTER)
      let expiredPages = 0;
      while (expiredPages < maxPagesPerTick && processedEligible < eligibleBatchLimit) {
        if (isOutboundNotificationsDisabled()) break;
        expiredPages++;
        const nowIso = new Date(this.getNowMs()).toISOString();
        const expiredQuery = buildExpiredProcessingOutboxQuery(fs, nowIso, pageSize, {
          startAfterDoc: this.expiredCursorDoc,
        });
        const snap = await expiredQuery.get();
        if (snap.empty) {
          this.expiredCursorDoc = null;
          summary.wrappedExpiredScan = true;
          break;
        }

        let lastDocInPage: DocumentSnapshot | any = null;
        let brokeEarly = false;
        for (const docSnap of snap.docs) {
          if (isOutboundNotificationsDisabled() || processedEligible >= eligibleBatchLimit) {
            brokeEarly = true;
            break;
          }
          lastDocInPage = docSnap;
          summary.scannedExpired++;

          const record = docSnap.data() as NotificationOutboxRecord;
          const baseCheck = this.validateRecordTimestampAndAllowlist(record, minCreatedAtMs, allowlist);
          if (!baseCheck.eligible) {
            if (baseCheck.reason === 'USER_NOT_ALLOWLISTED') {
              summary.skippedNotAllowlisted++;
            } else {
              summary.skippedHistoricalOrInvalid++;
            }
            continue;
          }

          const c2cCheck = await this.checkC2CPairEligibility(fs, record, allowlist);
          if (!c2cCheck.eligible) {
            summary.skippedNotAllowlisted++;
            continue;
          }

          const currentAttempts = Number(record.attemptCount || 0);
          const maxAttempts =
            typeof record.maxAttempts === 'number' && Number.isInteger(record.maxAttempts) && record.maxAttempts > 0
              ? record.maxAttempts
              : DEFAULT_OUTBOX_MAX_ATTEMPTS;

          if (currentAttempts >= maxAttempts) {
            const settled = await settleExhaustedOutboxRecord(fs, docSnap.id, {
              nowMs: this.getNowMs(),
              validateRecord: (liveRec) =>
                this.validateRecordTimestampAndAllowlist(liveRec, minCreatedAtMs, allowlist),
            });
            if (settled.settled && settled.reason === 'SETTLED_TO_DEAD_LETTER') {
              summary.deadLetteredCount++;
              processedEligible++;
            }
            continue;
          }

          const claimRes = await claimOutboxLease(
            fs,
            docSnap.id,
            this.instanceWorkerId,
            leaseDurationMs,
            this.getNowMs(),
            {
              validateRecord: (liveRec) =>
                this.validateRecordTimestampAndAllowlist(liveRec, minCreatedAtMs, allowlist),
            }
          );

          if (!claimRes.claimed || !claimRes.leaseToken || !claimRes.record) {
            continue;
          }

          summary.claimedCount++;
          processedEligible++;
          await this.processClaimedRecord(
            fs,
            claimRes.record,
            claimRes.leaseToken,
            allowlist,
            summary
          );
        }

        if (brokeEarly) {
          if (lastDocInPage) {
            this.expiredCursorDoc = lastDocInPage;
          }
          break;
        }

        if (snap.docs.length < pageSize) {
          this.expiredCursorDoc = null;
          summary.wrappedExpiredScan = true;
          break;
        }
        this.expiredCursorDoc = lastDocInPage;
      }

      // 2. Bounded cursor scan for retryable (PENDING & due FAILED_RETRYABLE) outbox records
      let retryablePages = 0;
      while (retryablePages < maxPagesPerTick && processedEligible < eligibleBatchLimit) {
        if (isOutboundNotificationsDisabled()) break;
        retryablePages++;
        const nowIso = new Date(this.getNowMs()).toISOString();
        const retryableQuery = buildRetryableOutboxQuery(fs, nowIso, pageSize, {
          minNextAttemptAtIso: minCreatedAtIso,
          startAfterDoc: this.retryableCursorDoc,
        });
        const snap = await retryableQuery.get();
        if (snap.empty) {
          this.retryableCursorDoc = null;
          summary.wrappedRetryableScan = true;
          break;
        }

        let lastDocInPage: DocumentSnapshot | any = null;
        let brokeEarly = false;
        for (const docSnap of snap.docs) {
          if (isOutboundNotificationsDisabled() || processedEligible >= eligibleBatchLimit) {
            brokeEarly = true;
            break;
          }
          lastDocInPage = docSnap;
          summary.scannedRetryable++;

          const record = docSnap.data() as NotificationOutboxRecord;
          const baseCheck = this.validateRecordTimestampAndAllowlist(record, minCreatedAtMs, allowlist);
          if (!baseCheck.eligible) {
            if (baseCheck.reason === 'USER_NOT_ALLOWLISTED') {
              summary.skippedNotAllowlisted++;
            } else {
              summary.skippedHistoricalOrInvalid++;
            }
            continue;
          }

          const c2cCheck = await this.checkC2CPairEligibility(fs, record, allowlist);
          if (!c2cCheck.eligible) {
            summary.skippedNotAllowlisted++;
            continue;
          }

          const currentAttempts = Number(record.attemptCount || 0);
          const maxAttempts =
            typeof record.maxAttempts === 'number' && Number.isInteger(record.maxAttempts) && record.maxAttempts > 0
              ? record.maxAttempts
              : DEFAULT_OUTBOX_MAX_ATTEMPTS;

          if (record.status === 'FAILED_RETRYABLE' && currentAttempts >= maxAttempts) {
            const settled = await settleExhaustedOutboxRecord(fs, docSnap.id, {
              nowMs: this.getNowMs(),
              validateRecord: (liveRec) =>
                this.validateRecordTimestampAndAllowlist(liveRec, minCreatedAtMs, allowlist),
            });
            if (settled.settled && settled.reason === 'SETTLED_TO_DEAD_LETTER') {
              summary.deadLetteredCount++;
              processedEligible++;
            }
            continue;
          }

          const claimRes = await claimOutboxLease(
            fs,
            docSnap.id,
            this.instanceWorkerId,
            leaseDurationMs,
            this.getNowMs(),
            {
              validateRecord: (liveRec) =>
                this.validateRecordTimestampAndAllowlist(liveRec, minCreatedAtMs, allowlist),
            }
          );

          if (!claimRes.claimed || !claimRes.leaseToken || !claimRes.record) {
            continue;
          }

          summary.claimedCount++;
          processedEligible++;
          await this.processClaimedRecord(
            fs,
            claimRes.record,
            claimRes.leaseToken,
            allowlist,
            summary
          );
        }

        if (brokeEarly) {
          if (lastDocInPage) {
            this.retryableCursorDoc = lastDocInPage;
          }
          break;
        }

        if (snap.docs.length < pageSize) {
          this.retryableCursorDoc = null;
          summary.wrappedRetryableScan = true;
          break;
        }
        this.retryableCursorDoc = lastDocInPage;
      }

      await this.saveCheckpoints(
        fs,
        configScopeHash,
        minCreatedAtIso,
        new Date(this.getNowMs()).toISOString()
      );
      return summary;
    } finally {
      this.isTickRunning = false;
    }
  }

  public start(): boolean {
    if (this.isStarted) {
      return false;
    }
    if (isVercelEnvironment()) {
      console.warn('[OutboxWorker] Startup rejected: running inside Vercel serverless runtime.');
      return false;
    }
    if (!isWorkerEnabledEnv()) {
      console.log('[OutboxWorker] Startup skipped: NOTIFICATION_WORKER_ENABLED is not "true".');
      return false;
    }
    if (isOutboundNotificationsDisabled()) {
      console.warn('[OutboxWorker] Startup skipped: DISABLE_OUTBOUND_NOTIFICATIONS is "true".');
      return false;
    }

    const rawMinCreatedAt =
      this.deps.minCreatedAt !== undefined
        ? this.deps.minCreatedAt
        : process.env.NOTIFICATION_OUTBOX_MIN_CREATED_AT;
    if (parseValidOutboxTimestampMs(rawMinCreatedAt) === null) {
      console.error(
        '[OutboxWorker] Startup rejected: NOTIFICATION_OUTBOX_MIN_CREATED_AT must be a valid ISO timestamp.'
      );
      return false;
    }

    const allowlistPolicy = resolveNotificationAllowlistPolicy({
      allowlistUidsRaw: this.deps.allowlistUidsRaw,
      allowlistModeRaw: this.deps.allowlistModeRaw,
      requireRestrictedOrExplicitOpen: true,
    });
    if (!allowlistPolicy.allowed) {
      console.error(
        '[OutboxWorker] Startup rejected: NOTIFICATION_ALLOWLIST_UIDS must contain at least one valid UID unless NOTIFICATION_ALLOWLIST_MODE=OPEN.'
      );
      return false;
    }

    const pollIntervalMs = Math.max(1000, this.deps.pollIntervalMs ?? DEFAULT_WORKER_POLL_INTERVAL_MS);
    this.isStarted = true;

    const scheduleNext = (delayMs: number) => {
      if (!this.isStarted) return;
      this.timerHandle = setTimeout(async () => {
        try {
          if (!this.isStarted) return;
          await this.runTick();
        } catch (err: any) {
          console.error('[OutboxWorker] Tick error:', err?.message || err);
        } finally {
          if (this.isStarted) {
            scheduleNext(pollIntervalMs);
          }
        }
      }, delayMs);
    };

    // Initial bounded poll scheduled cleanly after startup without blocking server listen
    scheduleNext(Math.min(5000, pollIntervalMs));
    console.log(
      `[OutboxWorker] Started non-overlapping durable outbox worker (${this.instanceWorkerId}) with ${pollIntervalMs}ms chained poll.`
    );
    return true;
  }

  public stop(): void {
    this.isStarted = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }
}

const defaultOutboxWorker = new NotificationOutboxWorker();

export async function runNotificationOutboxWorkerTick(
  deps?: NotificationOutboxWorkerDependencies
): Promise<NotificationOutboxWorkerTickSummary> {
  if (deps) {
    const scopedWorker = new NotificationOutboxWorker(deps);
    return scopedWorker.runTick();
  }
  return defaultOutboxWorker.runTick();
}

export function startNotificationOutboxWorker(
  deps?: NotificationOutboxWorkerDependencies
): NotificationOutboxWorker | null {
  if (deps) {
    const scopedWorker = new NotificationOutboxWorker(deps);
    return scopedWorker.start() ? scopedWorker : null;
  }
  return defaultOutboxWorker.start() ? defaultOutboxWorker : null;
}

export function stopNotificationOutboxWorker(worker?: NotificationOutboxWorker | null): void {
  if (worker) {
    worker.stop();
  } else {
    defaultOutboxWorker.stop();
  }
}
