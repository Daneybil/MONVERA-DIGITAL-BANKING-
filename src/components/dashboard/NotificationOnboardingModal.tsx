import React, { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Compass,
  X,
  Smartphone,
  AlertCircle,
  ExternalLink,
  Share,
  PlusSquare,
  ArrowDownLeft,
  ArrowUpRight,
  Landmark,
  BellOff,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { pushNotificationService, PushRegistrationResult } from '../../services/pushNotificationService';
import { firestoreSync } from '../../services/firestoreSync';
import { usePWAInstall, PWAInstallPlatform } from '../../hooks/usePWAInstall';

export const PUSH_ONBOARDING_STORAGE_PREFIX = 'monvera_push_invite_v1_';

export type PushOnboardingMode =
  | 'invite'
  | 'sync_needed'
  | 'denied'
  | 'ios_pwa_required'
  | 'unsupported';

export type PushOnboardingSuppressionReason =
  | 'no_user'
  | 'already_registered'
  | 'dismissed'
  | 'blocked_by_overlay';

export interface StoredPushInviteState {
  status: 'dismissed' | 'completed';
  permissionAtAction: NotificationPermission | 'unsupported';
  updatedAt: string;
}

export interface PushOnboardingEligibilityInput {
  userId?: string | null;
  browserPermission: NotificationPermission | 'unsupported';
  isPushSupported: boolean;
  registrationState: { token: string | null; userId: string | null };
  platform: PWAInstallPlatform;
  isStandalone: boolean;
  hasBlockingOverlay?: boolean;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
}

export type PushOnboardingEligibilityResult =
  | { shouldShow: true; mode: PushOnboardingMode }
  | { shouldShow: false; reason: PushOnboardingSuppressionReason };

function resolveStorage(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
  if (storage !== undefined) return storage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function getPushInviteDismissalState(
  userId: string,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): StoredPushInviteState | null {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage || !userId) return null;
  try {
    const raw = targetStorage.getItem(`${PUSH_ONBOARDING_STORAGE_PREFIX}${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.status === 'dismissed' || parsed.status === 'completed')) {
      return parsed as StoredPushInviteState;
    }
  } catch {
    // Ignore malformed local storage entries
  }
  return null;
}

export function savePushInviteState(
  userId: string,
  state: StoredPushInviteState,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage || !userId) return;
  try {
    targetStorage.setItem(`${PUSH_ONBOARDING_STORAGE_PREFIX}${userId}`, JSON.stringify(state));
  } catch {
    // Non-fatal if storage quota is unavailable
  }
}

export function evaluatePushOnboardingEligibility(
  input: PushOnboardingEligibilityInput
): PushOnboardingEligibilityResult {
  const userId = input.userId?.trim();
  if (!userId) {
    return { shouldShow: false, reason: 'no_user' };
  }

  const isDeviceRegisteredForUser =
    input.browserPermission === 'granted' &&
    Boolean(input.registrationState.token) &&
    input.registrationState.userId === userId;

  if (isDeviceRegisteredForUser) {
    return { shouldShow: false, reason: 'already_registered' };
  }

  if (input.hasBlockingOverlay) {
    return { shouldShow: false, reason: 'blocked_by_overlay' };
  }

  const stored = getPushInviteDismissalState(userId, input.storage);
  if (stored?.status === 'dismissed') {
    return { shouldShow: false, reason: 'dismissed' };
  }

  if (input.platform === 'ios' && !input.isStandalone) {
    return { shouldShow: true, mode: 'ios_pwa_required' };
  }

  if (!input.isPushSupported || input.browserPermission === 'unsupported') {
    return { shouldShow: true, mode: 'unsupported' };
  }

  if (input.browserPermission === 'denied') {
    return { shouldShow: true, mode: 'denied' };
  }

  if (input.browserPermission === 'granted') {
    return { shouldShow: true, mode: 'sync_needed' };
  }

  return { shouldShow: true, mode: 'invite' };
}

export interface PushFailureResolution {
  mode: PushOnboardingMode;
  feedbackError: string | null;
}

export function getActualBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return Notification.permission;
  }
  return 'unsupported';
}

export function resolvePushFailureState(params: {
  result: PushRegistrationResult;
  actualPermission: NotificationPermission | 'unsupported';
  platform: PWAInstallPlatform;
  isStandalone: boolean;
}): PushFailureResolution {
  const { result, actualPermission, platform, isStandalone } = params;

  if (actualPermission === 'unsupported' || result.status === 'unsupported') {
    return {
      mode: platform === 'ios' && !isStandalone ? 'ios_pwa_required' : 'unsupported',
      feedbackError: result.error || null,
    };
  }

  if (actualPermission === 'denied') {
    return {
      mode: 'denied',
      feedbackError:
        result.error && result.error !== 'Failed to acquire notification token.'
          ? result.error
          : null,
    };
  }

  if (actualPermission === 'granted') {
    return {
      mode: 'sync_needed',
      feedbackError:
        result.error ||
        'Notification permission was granted, but this device could not be registered right now. Please try again.',
    };
  }

  // actualPermission === 'default'
  if (result.status === 'default' && !result.error) {
    return {
      mode: 'invite',
      feedbackError:
        'Browser permission was not granted yet. Click Enable Notifications when you are ready, or continue using your in-app Notification Bell.',
    };
  }

  return {
    mode: 'invite',
    feedbackError:
      result.error ||
      'Unable to complete notification setup right now. Please try again, or continue using your in-app Notification Bell.',
  };
}

export interface NotificationOnboardingModalProps {
  suppress?: boolean;
  onOpenNotificationSettings?: () => void;
}

export const NotificationOnboardingModal: React.FC<NotificationOnboardingModalProps> = ({
  suppress = false,
  onOpenNotificationSettings,
}) => {
  const { currentUser, currentView } = useAuth();
  const { platform, isStandalone, isInAppBrowser } = usePWAInstall();

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<PushOnboardingMode>('invite');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [kycOverlayPresent, setKycOverlayPresent] = useState(false);

  // Coordinate politely with KycStatusAlertModal so onboarding never stacks on top of an active KYC popup
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const checkKycBackdrop = () => {
      setKycOverlayPresent(Boolean(document.getElementById('kyc-status-alert-backdrop')));
    };
    checkKycBackdrop();

    const observer = new MutationObserver(checkKycBackdrop);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [currentUser?.id, currentUser?.kycStatus]);

  const userId = currentUser?.id || null;

  useEffect(() => {
    if (!userId || currentView === 'admin') {
      setIsOpen(false);
      return;
    }

    let cancelled = false;

    const evaluateAndOpen = async () => {
      const browserPermission: NotificationPermission | 'unsupported' =
        getActualBrowserNotificationPermission();

      const isPushSupported = await pushNotificationService.checkSupport().catch(() => false);

      // If browser permission is already granted, allow silent registration sync to finish first
      if (browserPermission === 'granted' && isPushSupported) {
        const regBefore = pushNotificationService.getRegistrationState();
        if (!(regBefore.token && regBefore.userId === userId)) {
          await pushNotificationService.syncTokenForUser(userId).catch(() => null);
        }
      }

      if (cancelled) return;

      const regState = pushNotificationService.getRegistrationState();
      const eligibility = evaluatePushOnboardingEligibility({
        userId,
        browserPermission,
        isPushSupported,
        registrationState: regState,
        platform,
        isStandalone,
        hasBlockingOverlay: suppress || kycOverlayPresent,
      });

      if (eligibility.shouldShow) {
        setMode(eligibility.mode);
        setActivationSuccess(false);
        setFeedbackError(null);
        setIsOpen(true);
      } else if (!activationSuccess) {
        setIsOpen(false);
      }
    };

    const timer = window.setTimeout(() => {
      evaluateAndOpen();
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [userId, currentView, platform, isStandalone, suppress, kycOverlayPresent, activationSuccess]);

  // Listen for external push registration updates (e.g., if user enabled push from Notification Settings)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePushStatusUpdated = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (
        detail?.userId &&
        detail.userId === userId &&
        detail.status === 'granted' &&
        detail.token &&
        detail.source !== 'onboarding'
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener('monvera_push_status_updated', handlePushStatusUpdated);
    return () => window.removeEventListener('monvera_push_status_updated', handlePushStatusUpdated);
  }, [userId]);

  const handleDismiss = useCallback(() => {
    if (userId && !activationSuccess) {
      const permissionAtAction = getActualBrowserNotificationPermission();
      savePushInviteState(userId, {
        status: 'dismissed',
        permissionAtAction,
        updatedAt: new Date().toISOString(),
      });
    }
    setActivationSuccess(false);
    setIsOpen(false);
  }, [userId, activationSuccess]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleDismiss]);

  const handleEnableNotifications = async () => {
    if (!userId || isSubmitting) return;
    setFeedbackError(null);
    setIsSubmitting(true);

    try {
      const result: PushRegistrationResult = await pushNotificationService.requestPushPermission(userId);

      if (result.status === 'granted' && result.token && !result.error) {
        await firestoreSync.saveNotificationPreferences(userId, { pushEnabled: true }).catch(() => false);
        savePushInviteState(userId, {
          status: 'completed',
          permissionAtAction: 'granted',
          updatedAt: new Date().toISOString(),
        });

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('monvera_push_status_updated', {
              detail: {
                userId,
                status: 'granted',
                token: result.token,
                source: 'onboarding',
              },
            })
          );
        }

        setActivationSuccess(true);
        return;
      }

      const actualPermission = getActualBrowserNotificationPermission();
      const resolvedFailure = resolvePushFailureState({
        result,
        actualPermission,
        platform,
        isStandalone,
      });
      setMode(resolvedFailure.mode);
      setFeedbackError(resolvedFailure.feedbackError);
    } catch (err: any) {
      const actualPermission = getActualBrowserNotificationPermission();
      const resolvedFailure = resolvePushFailureState({
        result: {
          status: actualPermission,
          error: err?.message || 'Unable to complete notification setup. Please try again.',
        },
        actualPermission,
        platform,
        isStandalone,
      });
      setMode(resolvedFailure.mode);
      setFeedbackError(resolvedFailure.feedbackError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckPermissionAgain = async () => {
    if (!userId || isSubmitting) return;
    setFeedbackError(null);

    const currentPermission = getActualBrowserNotificationPermission();

    if (currentPermission === 'granted' || currentPermission === 'default') {
      await handleEnableNotifications();
      return;
    }

    if (currentPermission === 'unsupported') {
      setMode(platform === 'ios' && !isStandalone ? 'ios_pwa_required' : 'unsupported');
      return;
    }

    setFeedbackError(
      'Browser notifications are still blocked for Monvera. Switch Notifications from Block to Allow in your browser address bar settings, then click Check Permission Again.'
    );
  };

  if (!isOpen || !currentUser || suppress || kycOverlayPresent) return null;

  const isInviteOrSync = mode === 'invite' || mode === 'sync_needed';

  return (
    <div
      id="notification-onboarding-backdrop"
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monvera-push-onboarding-title"
    >
      <div
        id="notification-onboarding-modal"
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden text-slate-900"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 bg-slate-950 text-white border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3.5 min-w-0">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                activationSuccess
                  ? 'bg-emerald-500/25 border-emerald-400 text-emerald-300'
                  : mode === 'denied'
                  ? 'bg-amber-500/20 border-amber-400/50 text-amber-300'
                  : mode === 'unsupported'
                  ? 'bg-slate-800 border-slate-600 text-white'
                  : 'bg-emerald-500/25 border-emerald-400/60 text-emerald-300'
              }`}
            >
              {activationSuccess ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : mode === 'denied' ? (
                <BellOff className="w-5 h-5" />
              ) : mode === 'ios_pwa_required' || mode === 'unsupported' ? (
                <Smartphone className="w-5 h-5" />
              ) : (
                <Bell className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-black text-emerald-300 tracking-wide uppercase">
                Monvera Account Alerts
              </p>
              <h2
                id="monvera-push-onboarding-title"
                className="text-xl sm:text-2xl font-black text-white tracking-tight mt-0.5 leading-snug"
              >
                {activationSuccess
                  ? 'Automatic Transaction Alerts Enabled'
                  : mode === 'denied'
                  ? 'Browser Notifications Are Blocked'
                  : mode === 'ios_pwa_required'
                  ? 'Install Monvera for iPhone Alerts'
                  : mode === 'unsupported'
                  ? 'In-App Notifications Are Active'
                  : mode === 'sync_needed'
                  ? 'Complete Device Notification Setup'
                  : 'Enable Automatic Transaction Alerts'}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss notification invitation"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white border border-slate-600 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 sm:p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {activationSuccess ? (
            <div
              id="notification-onboarding-success"
              className="rounded-2xl bg-emerald-50 border-2 border-emerald-300 p-5 space-y-3"
            >
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-1.5">
                  <div className="text-base font-black text-slate-950">
                    This device is now registered for Monvera push alerts
                  </div>
                  <p className="text-sm font-bold text-slate-900 leading-relaxed">
                    Browser permission has been granted and device registration completed
                    successfully. You will receive real-time alerts right from this account
                    alongside your in-app Notification Bell.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {isInviteOrSync && (
                <>
                  <p className="text-sm sm:text-[15px] text-slate-950 font-extrabold leading-relaxed">
                    {mode === 'sync_needed'
                      ? 'Browser permission is enabled, but this device is not registered with Monvera yet. Confirm setup below to receive push alerts on this device.'
                      : 'Stay informed in real time as account activity completes. Enabling notifications lets Monvera deliver instant device alerts alongside your in-app Notification Center.'}
                  </p>

                  {/* Accurate explanation of supported backend notification events */}
                  <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-4 space-y-3">
                    <div className="text-xs sm:text-sm font-black uppercase tracking-wider text-slate-950">
                      What You Will Receive
                    </div>

                    <div className="space-y-3 text-sm text-slate-900 font-bold">
                      <div className="flex items-start gap-2.5">
                        <ArrowDownLeft className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                        <div>
                          <span className="font-black text-slate-950">Money Received:</span> Amount,
                          verified sender name, date and time, and completed transaction status.
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <ArrowUpRight className="w-4 h-4 text-slate-900 shrink-0 mt-1 stroke-[2.5]" />
                        <div>
                          <span className="font-black text-slate-950">Money Sent:</span> Amount,
                          recipient name, date and time, and completed transfer status.
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <Landmark className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                        <div>
                          <span className="font-black text-slate-950">Deposits Settled:</span>{' '}
                          Verified deposit amount, settlement time, and completed status.
                        </div>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-sky-700 shrink-0 mt-1 stroke-[2.5]" />
                        <div>
                          <span className="font-black text-slate-950">
                            Completed Account &amp; Security Events:
                          </span>{' '}
                          Completed investment maturities, approved loan or withdrawal updates, and
                          account security notices. Pending, failed, or reversed items are always
                          labeled accurately.
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {mode === 'denied' && (
                <>
                  <p className="text-sm sm:text-[15px] text-slate-950 font-extrabold leading-relaxed">
                    Notifications are currently blocked for Monvera in this browser. Your in-app
                    Notification Bell remains fully active, and you can turn browser push back on
                    anytime in your browser site settings:
                  </p>

                  <div className="rounded-2xl bg-amber-50 border-2 border-amber-300 p-4 space-y-2.5 text-sm text-amber-950">
                    <div className="font-black text-slate-950">
                      How to Allow Notifications in Browser Settings
                    </div>
                    <ol className="list-decimal list-inside space-y-2 font-bold text-amber-950">
                      <li>Click the lock or site-settings icon in your browser address bar.</li>
                      <li>
                        Locate <strong className="font-black text-slate-950">Notifications</strong>{' '}
                        and switch it from <strong className="font-black text-slate-950">Block</strong>{' '}
                        to <strong className="font-black text-slate-950">Allow</strong>.
                      </li>
                      <li>
                        Click <strong className="font-black text-slate-950">Check Permission Again</strong>{' '}
                        below (or reload this page) to finish registering this device.
                      </li>
                    </ol>
                  </div>
                </>
              )}

              {mode === 'ios_pwa_required' && (
                <>
                  <p className="text-sm sm:text-[15px] text-slate-950 font-extrabold leading-relaxed">
                    On iPhone and iPad, supported Web Push notifications require adding Monvera to
                    your Home Screen in Safari (iOS 16.4 or later) and granting notification
                    permission. Your in-app Notification Bell continues working immediately.
                  </p>

                  {isInAppBrowser && (
                    <div className="p-3.5 rounded-2xl bg-amber-50 border-2 border-amber-300 text-xs sm:text-sm font-bold text-amber-950 flex items-start gap-2.5">
                      <ExternalLink className="w-4 h-4 text-amber-800 shrink-0 mt-0.5 stroke-[2.5]" />
                      <div>
                        <strong className="block font-black text-slate-950">
                          Open in Safari First
                        </strong>
                        In-app browsers cannot install Home Screen web apps. Choose{' '}
                        <strong className="font-black text-slate-950">Open in Safari</strong> first,
                        then follow the steps below.
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl bg-slate-50 border-2 border-slate-200 p-4 space-y-3 text-sm font-bold text-slate-950">
                    <div className="flex items-start gap-2.5">
                      <Compass className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                      <span>
                        1. Open <strong className="font-black text-slate-950">Monvera</strong> in{' '}
                        <strong className="font-black text-slate-950">Safari</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <Share className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                      <span>
                        2. Tap the <strong className="font-black text-slate-950">Share</strong> icon
                        in Safari.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <PlusSquare className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                      <span>
                        3. Select{' '}
                        <strong className="font-black text-slate-950">Add to Home Screen</strong>.
                      </span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <Bell className="w-4 h-4 text-emerald-700 shrink-0 mt-1 stroke-[2.5]" />
                      <span>
                        4. Confirm <strong className="font-black text-slate-950">Add</strong>, then
                        open <strong className="font-black text-slate-950">Monvera</strong> from your
                        Home Screen and enable alerts when prompted.
                      </span>
                    </div>
                  </div>
                </>
              )}

              {mode === 'unsupported' && (
                <div className="space-y-3">
                  <p className="text-sm sm:text-[15px] text-slate-950 font-extrabold leading-relaxed">
                    This browser or viewing container does not support background Web Push
                    notifications. For full device push alerts, open Monvera in Chrome on Android, a
                    supported desktop browser, or an installed Home Screen app on supported iOS
                    devices.
                  </p>
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border-2 border-emerald-300 text-sm text-emerald-950 font-bold">
                    Your in-app <strong className="font-black text-slate-950">Notification Bell</strong>{' '}
                    in the top header stays active automatically for all deposits, transfers, loans,
                    investments, and security alerts.
                  </div>
                </div>
              )}

              {feedbackError && (
                <div
                  id="notification-onboarding-error"
                  className="p-3.5 rounded-2xl bg-rose-50 border-2 border-rose-300 text-sm text-rose-950 font-bold flex items-start gap-2.5"
                >
                  <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-1 stroke-[2.5]" />
                  <span>{feedbackError}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:p-5 bg-slate-100 border-t border-slate-200 space-y-3 shrink-0">
          {activationSuccess ? (
            <div className="flex justify-end">
              <button
                type="button"
                id="notification-onboarding-continue-btn"
                onClick={() => {
                  setActivationSuccess(false);
                  setIsOpen(false);
                }}
                className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm sm:text-[15px] font-black text-white bg-emerald-700 hover:bg-emerald-800 transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Continue to Dashboard</span>
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
                <button
                  type="button"
                  id="notification-onboarding-dismiss-btn"
                  onClick={handleDismiss}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-4 py-3 rounded-xl text-sm font-black text-slate-950 bg-white hover:bg-slate-200 border-2 border-slate-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isInviteOrSync ? 'Not Now' : 'Continue to Dashboard'}
                </button>

                {isInviteOrSync ? (
                  <button
                    type="button"
                    id="notification-onboarding-enable-btn"
                    onClick={handleEnableNotifications}
                    disabled={isSubmitting}
                    className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm sm:text-[15px] font-black text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <Bell className="w-4 h-4" />
                    <span>{isSubmitting ? 'Enabling Notifications...' : 'Enable Notifications'}</span>
                  </button>
                ) : (
                  mode === 'denied' && (
                    <button
                      type="button"
                      id="notification-onboarding-retry-btn"
                      onClick={handleCheckPermissionAgain}
                      disabled={isSubmitting}
                      className="w-full sm:w-auto px-5 py-3 rounded-xl text-sm sm:text-[15px] font-black text-white bg-slate-950 hover:bg-slate-900 disabled:opacity-60 transition-colors shadow-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className={`w-4 h-4 text-emerald-400 ${isSubmitting ? 'animate-spin' : ''}`} />
                      <span>Check Permission Again</span>
                    </button>
                  )
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs font-bold text-slate-900">
                {onOpenNotificationSettings ? (
                  <button
                    type="button"
                    id="notification-onboarding-open-settings-btn"
                    onClick={() => {
                      handleDismiss();
                      onOpenNotificationSettings();
                    }}
                    className="text-emerald-800 hover:text-emerald-950 underline font-black cursor-pointer"
                  >
                    Open Notification Preferences
                  </button>
                ) : (
                  <span />
                )}
                <p className="text-center sm:text-right">
                  You can update alert channels anytime from the Notification Bell → Preferences.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
