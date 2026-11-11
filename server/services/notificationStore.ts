// Monvera Digital Banking — Centralized Authoritative Customer Notification Store
// Writes deterministic, idempotent, customer-isolated notifications to Firestore & in-memory db.

import { adminFirestore, isFirebaseAdminConfigured } from '../firebaseAdmin';
import { db } from '../db';
import { NotificationItem } from '../../src/types';

export interface PersistNotificationInput {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'TRANSACTION' | 'SECURITY' | 'INVESTMENT' | 'SYSTEM' | 'SUPPORT';
  severity: 'info' | 'success' | 'warning' | 'support' | 'error';
  referenceId?: string;
  createdAt?: string;
  actionView?: NotificationItem['actionView'];
  actionModal?: NotificationItem['actionModal'];
  actionSection?: string;
  actionRecordId?: string;
  metadata?: NotificationItem['metadata'];
}

export function maskAccountNumber(acc?: string | null): string {
  if (!acc) return '•••• 0000';
  const cleaned = String(acc).replace(/\s+/g, '');
  if (!cleaned) return '•••• 0000';
  const last4 = cleaned.length >= 4 ? cleaned.slice(-4) : cleaned;
  return `MVB •••• ${last4}`;
}

export async function resolveCustomerNotificationContext(userId: string): Promise<{
  uid: string;
  customerName: string;
  maskedAccountNumber: string;
  email?: string;
}> {
  let customerName = 'Monvera Client';
  let accountNumber = '';
  let email: string | undefined = undefined;

  const memUser = db.users.get(userId);
  if (memUser) {
    customerName =
      memUser.kycFullName ||
      memUser.fullName ||
      `${memUser.firstName || ''} ${memUser.lastName || ''}`.trim() ||
      memUser.username ||
      customerName;
    accountNumber = memUser.permanentAccountNumber || accountNumber;
    email = memUser.email || email;
  }

  if (isFirebaseAdminConfigured() && userId) {
    try {
      const userSnap = await adminFirestore.collection('users').doc(userId).get();
      if (userSnap.exists) {
        const d = userSnap.data() || {};
        const fsName =
          d.verifiedLegalName ||
          d.kycFullName ||
          d.fullName ||
          `${d.firstName || ''} ${d.lastName || ''}`.trim() ||
          d.username;
        if (fsName) customerName = fsName;
        if (d.permanentAccountNumber || d.accountNumber) {
          accountNumber = d.permanentAccountNumber || d.accountNumber;
        }
        if (d.email) email = d.email;
      }
    } catch {
      // Non-blocking lookup
    }
  }

  return {
    uid: userId,
    customerName,
    maskedAccountNumber: maskAccountNumber(accountNumber),
    email,
  };
}

/**
 * Strips `undefined` keys recursively so Firestore Admin SDK never rejects optional fields.
 */
function stripUndefined<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = stripUndefined(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Persists a customer notification with deterministic ID idempotency.
 * - Never creates duplicate notifications on retry if the same deterministic `id` was already stored.
 * - Preserves `read: true` if an existing notification was already read.
 * - Never throws or blocks financial/account operations.
 */
export async function persistCustomerNotification(
  input: PersistNotificationInput
): Promise<NotificationItem | null> {
  if (!input?.id || !input?.userId) return null;

  const nowIso = input.createdAt || new Date().toISOString();

  // Enrich customerName / maskedAccountNumber if omitted
  let enrichedMeta = input.metadata ? { ...input.metadata } : {};
  if (!enrichedMeta.customerName || !enrichedMeta.accountNumberMasked) {
    try {
      const ctx = await resolveCustomerNotificationContext(input.userId);
      if (!enrichedMeta.customerName) enrichedMeta.customerName = ctx.customerName;
      if (!enrichedMeta.accountNumberMasked) enrichedMeta.accountNumberMasked = ctx.maskedAccountNumber;
    } catch {}
  }
  if (input.referenceId && !enrichedMeta.referenceNumber) {
    enrichedMeta.referenceNumber = input.referenceId;
  }
  if (!enrichedMeta.date) {
    enrichedMeta.date = nowIso;
  }

  const notifItem: NotificationItem = stripUndefined({
    id: input.id,
    userId: input.userId,
    title: input.title,
    message: input.message,
    type: input.type,
    severity: input.severity,
    read: false,
    createdAt: nowIso,
    referenceId: input.referenceId,
    actionView: input.actionView,
    actionModal: input.actionModal,
    actionSection: input.actionSection,
    actionRecordId: input.actionRecordId,
    metadata: Object.keys(enrichedMeta).length > 0 ? stripUndefined(enrichedMeta) : undefined,
  });

  // 1. Update in-memory list idempotently (preserve existing read state if already present)
  const existingMemIdx = db.notifications.findIndex((n) => n.id === input.id);
  if (existingMemIdx >= 0) {
    const existingMem = db.notifications[existingMemIdx];
    const merged: NotificationItem = {
      ...notifItem,
      read: Boolean(existingMem.read),
      createdAt: existingMem.createdAt || notifItem.createdAt,
    };
    db.notifications[existingMemIdx] = merged;
  } else {
    db.notifications.unshift(notifItem);
  }

  // 2. Persist atomically/idempotently to Firestore without overwriting `read: true`
  if (isFirebaseAdminConfigured()) {
    try {
      const docRef = adminFirestore.collection('notifications').doc(input.id);
      const existingSnap = await docRef.get();
      if (existingSnap.exists) {
        const existingData = existingSnap.data() || {};
        // Preserve read state & original timestamp on idempotent retry
        const updatePayload = stripUndefined({
          ...notifItem,
          read: Boolean(existingData.read),
          createdAt: existingData.createdAt || notifItem.createdAt,
          syncedAt: new Date().toISOString(),
        });
        await docRef.set(updatePayload, { merge: true });
        return updatePayload as NotificationItem;
      } else {
        await docRef.set(
          stripUndefined({
            ...notifItem,
            syncedAt: new Date().toISOString(),
          })
        );
      }
    } catch (err: any) {
      console.warn('[NotificationStore] Firestore write note:', err?.message || err);
    }
  }

  return notifItem;
}
