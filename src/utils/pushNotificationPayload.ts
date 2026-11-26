export type PushNotificationDirection = 'DEBIT' | 'CREDIT' | 'INFO';

export type SafeNotificationAppView =
  | 'dashboard'
  | 'transactions'
  | 'accounts'
  | 'investments'
  | 'cards'
  | 'loans'
  | 'profile'
  | 'business';

const ALLOWED_NOTIFICATION_VIEWS = new Set<SafeNotificationAppView>([
  'dashboard',
  'transactions',
  'accounts',
  'investments',
  'cards',
  'loans',
  'profile',
  'business',
]);

export const NOTIFICATION_NAV_STORAGE_KEY = 'monvera_notification_nav_target';

export interface NotificationNavTarget {
  notificationId?: string;
  actionView: SafeNotificationAppView;
  actionRecordId?: string;
  referenceNumber?: string;
  url?: string;
  timestamp: number;
}

export interface NormalizedPushNotification {
  id: string;
  dedupeKey: string;
  title: string;
  body: string;
  direction: PushNotificationDirection;
  amount?: string;
  currency?: string;
  description?: string;
  referenceId?: string;
  transactionId?: string;
  category?: string;
  type?: string;
  actionView: SafeNotificationAppView;
  url: string;
  timestamp: number;
}

export function sanitizePushActionView(
  rawView: unknown,
  fallback: SafeNotificationAppView = 'transactions'
): SafeNotificationAppView {
  if (typeof rawView !== 'string') return fallback;
  const clean = rawView.trim().toLowerCase() as SafeNotificationAppView;
  return ALLOWED_NOTIFICATION_VIEWS.has(clean) ? clean : fallback;
}

export function sanitizeRelativeAppUrl(rawUrl: unknown, fallback: string = '/dashboard?view=transactions'): string {
  if (typeof rawUrl !== 'string') return fallback;
  const trimmed = rawUrl.trim();
  if (!trimmed) return fallback;

  // Allow same-origin absolute URLs only when converting back to relative path?
  // Wait: in browser/SW, callers pass either relative '/dashboard?...' or full URL with unknown origin.
  // Reject protocol-relative '//' and external origins cleanly.
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed.slice(0, 300);
  }
  return fallback;
}

export function buildPushDeepLinkUrl(params: {
  baseUrl?: string;
  actionView?: string;
  transactionId?: string;
  referenceId?: string;
}): string {
  const safeBase = sanitizeRelativeAppUrl(params.baseUrl, '/dashboard?view=transactions');
  try {
    const parsed = new URL(safeBase, 'https://monvera.invalid');
    const resolvedView = sanitizePushActionView(
      params.actionView || parsed.searchParams.get('view'),
      'transactions'
    );
    parsed.searchParams.set('view', resolvedView);

    const txId = typeof params.transactionId === 'string' ? params.transactionId.trim() : '';
    const refId = typeof params.referenceId === 'string' ? params.referenceId.trim() : '';
    if (txId && txId !== 'MV-ALERT') {
      parsed.searchParams.set('transactionId', txId.slice(0, 128));
    }
    if (refId && refId !== 'MV-ALERT') {
      parsed.searchParams.set('referenceId', refId.slice(0, 128));
    }
    return `${parsed.pathname}${parsed.search}`.slice(0, 300);
  } catch {
    return '/dashboard?view=transactions';
  }
}

export function inferPushDirection(raw: {
  direction?: unknown;
  type?: unknown;
  eventKey?: unknown;
  title?: unknown;
  body?: unknown;
}): PushNotificationDirection {
  const explicit = typeof raw.direction === 'string' ? raw.direction.trim().toUpperCase() : '';
  if (explicit === 'DEBIT' || explicit === 'CREDIT' || explicit === 'INFO') {
    return explicit;
  }

  const eventType = typeof raw.type === 'string' ? raw.type.trim().toUpperCase() : '';
  if (eventType === 'MONEY_SENT') return 'DEBIT';
  if (eventType === 'MONEY_RECEIVED') return 'CREDIT';

  const eventKey = typeof raw.eventKey === 'string' ? raw.eventKey.toUpperCase() : '';
  if (eventKey.endsWith(':REVERSED')) return 'CREDIT';

  const text = `${String(raw.title || '')} ${String(raw.body || '')}`.toLowerCase();
  if (
    text.includes('account debited') ||
    text.includes('has been debited') ||
    text.includes('withdrawal') ||
    text.includes('repayment') ||
    text.includes('fee was debited') ||
    text.includes('you sent') ||
    text.includes('check issued') ||
    text.includes('wire check') ||
    text.includes('investment activated')
  ) {
    return 'DEBIT';
  }
  if (
    text.includes('account credited') ||
    text.includes('has received') ||
    text.includes('credited back') ||
    text.includes('credited to') ||
    text.includes('you received') ||
    text.includes('deposit') ||
    text.includes('matured') ||
    text.includes('disbursed') ||
    text.includes('welcome reward')
  ) {
    return 'CREDIT';
  }

  return 'INFO';
}

export function normalizePushPayload(rawPayload: any): NormalizedPushNotification {
  const fcmMsg =
    rawPayload?.FCM_MSG ||
    rawPayload?.notification?.data?.FCM_MSG ||
    rawPayload?.data?.FCM_MSG;

  const root = fcmMsg && typeof fcmMsg === 'object' ? fcmMsg : rawPayload || {};
  const data = (root.data && typeof root.data === 'object' ? root.data : rawPayload?.data) || {};
  const notif = (root.notification && typeof root.notification === 'object' ? root.notification : rawPayload?.notification) || {};

  const title =
    (typeof data.title === 'string' && data.title.trim()) ||
    (typeof notif.title === 'string' && notif.title.trim()) ||
    (typeof root.title === 'string' && root.title.trim()) ||
    'Monvera Account Alert';

  const body =
    (typeof data.body === 'string' && data.body.trim()) ||
    (typeof notif.body === 'string' && notif.body.trim()) ||
    (typeof root.body === 'string' && root.body.trim()) ||
    (typeof root.message === 'string' && root.message.trim()) ||
    'New financial activity recorded on your Monvera account.';

  const transactionId =
    (typeof data.transactionId === 'string' && data.transactionId.trim()) ||
    (typeof root.transactionId === 'string' && root.transactionId.trim()) ||
    undefined;

  const referenceId =
    (typeof data.referenceId === 'string' && data.referenceId.trim()) ||
    (typeof root.referenceId === 'string' && root.referenceId.trim()) ||
    undefined;

  const category =
    (typeof data.category === 'string' && data.category.trim()) ||
    (typeof root.category === 'string' && root.category.trim()) ||
    undefined;

  const type =
    (typeof data.type === 'string' && data.type.trim()) ||
    (typeof root.type === 'string' && root.type.trim()) ||
    undefined;

  const eventKey =
    (typeof data.eventKey === 'string' && data.eventKey.trim()) ||
    (typeof root.eventKey === 'string' && root.eventKey.trim()) ||
    undefined;

  const direction = inferPushDirection({
    direction: data.direction ?? root.direction,
    type,
    eventKey,
    title,
    body,
  });

  const rawUrl =
    (typeof data.url === 'string' && data.url.trim()) ||
    (typeof root.fcmOptions?.link === 'string' && root.fcmOptions.link.trim()) ||
    (typeof notif.click_action === 'string' && notif.click_action.trim()) ||
    (typeof root.url === 'string' && root.url.trim()) ||
    '';

  let extractedRelativeUrl = '';
  if (rawUrl) {
    if (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) {
      extractedRelativeUrl = rawUrl;
    } else {
      try {
        const parsedAbs = new URL(rawUrl);
        extractedRelativeUrl = `${parsedAbs.pathname}${parsedAbs.search}`;
      } catch {
        extractedRelativeUrl = '';
      }
    }
  }

  let viewFromUrl: string | null = null;
  if (extractedRelativeUrl) {
    try {
      viewFromUrl = new URL(extractedRelativeUrl, 'https://monvera.invalid').searchParams.get('view');
    } catch {
      viewFromUrl = null;
    }
  }

  const defaultView: SafeNotificationAppView =
    category === 'SECURITY'
      ? 'profile'
      : category === 'INVESTMENT' && !transactionId
      ? 'investments'
      : 'transactions';

  const actionView = sanitizePushActionView(
    data.actionView || root.actionView || viewFromUrl || defaultView,
    defaultView
  );

  const url = buildPushDeepLinkUrl({
    baseUrl: extractedRelativeUrl || `/dashboard?view=${actionView}`,
    actionView,
    transactionId,
    referenceId,
  });

  const rawTimestamp = data.timestamp ?? root.timestamp;
  const parsedTs =
    typeof rawTimestamp === 'number'
      ? rawTimestamp
      : typeof rawTimestamp === 'string' && !Number.isNaN(Date.parse(rawTimestamp))
      ? Date.parse(rawTimestamp)
      : Date.now();

  const dedupeParts = [
    eventKey || transactionId || referenceId || '',
    type || '',
    direction,
    title,
    body,
  ].filter(Boolean);
  const dedupeKey = dedupeParts.join('::') || `${title}::${body}`;

  const id =
    (typeof root.fcmMessageId === 'string' && root.fcmMessageId.trim()) ||
    (eventKey ? `push_${eventKey}_${type || direction}` : '') ||
    `push_${transactionId || referenceId || parsedTs}`;

  const rawAmount = data.amount ?? root.amount;
  const amount =
    typeof rawAmount === 'number' && Number.isFinite(rawAmount)
      ? String(rawAmount)
      : typeof rawAmount === 'string' && rawAmount.trim()
      ? rawAmount.trim()
      : undefined;

  const rawCurrency = data.currency ?? root.currency;
  const currency =
    typeof rawCurrency === 'string' && rawCurrency.trim() ? rawCurrency.trim() : undefined;

  const rawDescription = data.description ?? root.description;
  const description =
    typeof rawDescription === 'string' && rawDescription.trim() ? rawDescription.trim() : undefined;

  return {
    id,
    dedupeKey,
    title,
    body,
    direction,
    amount,
    currency,
    description,
    referenceId,
    transactionId,
    category,
    type,
    actionView,
    url,
    timestamp: parsedTs,
  };
}

export function buildNotificationNavTargetFromNormalized(
  normalized: NormalizedPushNotification
): NotificationNavTarget {
  return {
    notificationId: normalized.id,
    actionView: normalized.actionView,
    actionRecordId: normalized.transactionId || normalized.referenceId,
    referenceNumber: normalized.referenceId || normalized.transactionId,
    url: normalized.url,
    timestamp: Date.now(),
  };
}

export function parseNotificationDeepLinkFromUrl(
  pathname: string,
  search: string
): NotificationNavTarget | null {
  try {
    const cleanPath = String(pathname || '/').replace(/\/+$/, '') || '/';
    const params = new URLSearchParams(search || '');
    const viewParam = params.get('view');
    const transactionId = params.get('transactionId')?.trim() || '';
    const referenceId = params.get('referenceId')?.trim() || '';

    const isDashboardPath = cleanPath.toLowerCase() === '/dashboard';
    const hasNotificationQuery = Boolean(viewParam || transactionId || referenceId);

    if (!isDashboardPath && !hasNotificationQuery) {
      return null;
    }

    const actionView = sanitizePushActionView(
      viewParam,
      transactionId || referenceId ? 'transactions' : 'dashboard'
    );

    return {
      actionView,
      actionRecordId: transactionId || referenceId || undefined,
      referenceNumber: referenceId || transactionId || undefined,
      url: buildPushDeepLinkUrl({
        baseUrl: `/dashboard?view=${actionView}`,
        actionView,
        transactionId: transactionId || undefined,
        referenceId: referenceId || undefined,
      }),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

export function savePendingNotificationNavTarget(
  target: NotificationNavTarget,
  storage?: Pick<Storage, 'setItem'> | null
): void {
  try {
    const targetStorage = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!targetStorage) return;
    targetStorage.setItem(NOTIFICATION_NAV_STORAGE_KEY, JSON.stringify(target));
  } catch {
    // Ignore restricted storage errors
  }
}

export function readPendingNotificationNavTarget(
  storage?: Pick<Storage, 'getItem'> | null
): NotificationNavTarget | null {
  try {
    const targetStorage = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!targetStorage) return null;
    const raw = targetStorage.getItem(NOTIFICATION_NAV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      notificationId: typeof parsed.notificationId === 'string' ? parsed.notificationId : undefined,
      actionView: sanitizePushActionView(parsed.actionView, 'transactions'),
      actionRecordId: typeof parsed.actionRecordId === 'string' ? parsed.actionRecordId : undefined,
      referenceNumber: typeof parsed.referenceNumber === 'string' ? parsed.referenceNumber : undefined,
      url: typeof parsed.url === 'string' ? sanitizeRelativeAppUrl(parsed.url) : undefined,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}

export function clearPendingNotificationNavTarget(
  storage?: Pick<Storage, 'removeItem'> | null
): void {
  try {
    const targetStorage = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : null);
    if (!targetStorage) return;
    targetStorage.removeItem(NOTIFICATION_NAV_STORAGE_KEY);
  } catch {
    // Ignore restricted storage errors
  }
}

export class PushNotificationDeduplicator {
  private seen = new Map<string, number>();

  constructor(
    private readonly windowMs: number = 60_000,
    private readonly maxEntries: number = 100
  ) {}

  public shouldAccept(dedupeKey: string, nowMs: number = Date.now()): boolean {
    const cleanKey = String(dedupeKey || '').trim();
    if (!cleanKey) return true;

    const existingTs = this.seen.get(cleanKey);
    if (existingTs !== undefined && nowMs - existingTs < this.windowMs) {
      return false;
    }

    this.seen.set(cleanKey, nowMs);

    if (this.seen.size > this.maxEntries) {
      for (const [key, ts] of this.seen.entries()) {
        if (nowMs - ts >= this.windowMs || this.seen.size > this.maxEntries) {
          this.seen.delete(key);
        }
        if (this.seen.size <= this.maxEntries) break;
      }
    }

    return true;
  }

  public clear(): void {
    this.seen.clear();
  }
}
