/**
 * MONVERA — AUTOMATIC CUSTOMER NOTIFICATION ONBOARDING & BELL VISIBILITY VERIFICATION SUITE
 *
 * Covers all 7 requested functional scenarios:
 *  1. Invitation eligibility when browser permission is not granted ('default').
 *  2. Successful permission and device registration flow via PushNotificationService.
 *  3. Non-reappearance after successful registration & failed registration error handling (no false success).
 *  4. Per-device dismissal persistence across subsequent logins.
 *  5. Denied-permission experience (guidance mode, no automatic OS prompt).
 *  6. In-app Notification Bell availability when browser push is disabled / denied / unsupported + mobile & desktop responsiveness checks.
 *  7. iOS Home Screen PWA requirement & unsupported browser handling.
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import {
  evaluatePushOnboardingEligibility,
  getPushInviteDismissalState,
  savePushInviteState,
  resolvePushFailureState,
  PUSH_ONBOARDING_STORAGE_PREFIX,
} from './src/components/dashboard/NotificationOnboardingModal';
import { PushNotificationService } from './src/services/pushNotificationService';

class InMemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

async function runTests() {
  console.log('Running Monvera Notification Onboarding & Bell Visibility Tests...');

  // -------------------------------------------------------------------------
  // 1. Invitation appears when browser permission is not granted ('default')
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();
    const res = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'default',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(res, { shouldShow: true, mode: 'invite' });
    console.log('  ✓ Test 1: Invitation eligible when permission is default and device unregistered');
  }

  // -------------------------------------------------------------------------
  // 2. Successful permission + device registration, and no false success on failure
  // -------------------------------------------------------------------------
  {
    let permissionRequested = 0;
    let postedEndpoint = '';
    let postedPayload: Record<string, any> | null = null;
    const fakeSwReg = { active: { state: 'activated' }, scope: 'https://monvera.test/' } as unknown as ServiceWorkerRegistration;

    const pushSvc = new PushNotificationService({
      getCurrentUid: () => 'cust_alice',
      isSupportedFn: async () => true,
      getNotificationPermissionFn: () => 'default',
      requestNotificationPermissionFn: async () => {
        permissionRequested += 1;
        return 'granted';
      },
      ensureActiveSwFn: async () => fakeSwReg,
      acquireFcmTokenFn: async () => 'fcm_live_token_1234567890abcdef',
      postPushEndpoint: async (endpoint, payload) => {
        postedEndpoint = endpoint;
        postedPayload = payload;
        return true;
      },
    });

    const result = await pushSvc.requestPushPermission('cust_alice');
    assert.strictEqual(permissionRequested, 1);
    assert.strictEqual(result.status, 'granted');
    assert.strictEqual(result.token, 'fcm_live_token_1234567890abcdef');
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(postedEndpoint, '/api/push/register');
    assert.strictEqual((postedPayload as any)?.token, 'fcm_live_token_1234567890abcdef');

    // Device state is now registered for cust_alice
    const regState = pushSvc.getRegistrationState();
    assert.strictEqual(regState.userId, 'cust_alice');
    assert.strictEqual(regState.token, 'fcm_live_token_1234567890abcdef');

    // Negative test: when backend registration fails, no token/false-success is returned
    const failingSvc = new PushNotificationService({
      getCurrentUid: () => 'cust_alice',
      isSupportedFn: async () => true,
      getNotificationPermissionFn: () => 'default',
      requestNotificationPermissionFn: async () => 'granted',
      ensureActiveSwFn: async () => fakeSwReg,
      acquireFcmTokenFn: async () => 'fcm_live_token_1234567890abcdef',
      postPushEndpoint: async () => false,
    });
    const failedResult = await failingSvc.requestPushPermission('cust_alice');
    assert.strictEqual(failedResult.status, 'granted');
    assert.strictEqual(failedResult.token, undefined);
    assert.ok(failedResult.error && failedResult.error.includes('Failed to register'));
    assert.strictEqual(failingSvc.getRegistrationState().token, null);

    console.log('  ✓ Test 2: Permission + /api/push/register succeeds cleanly; failure never reports false success');
  }

  // -------------------------------------------------------------------------
  // 3. Invitation does NOT reappear after successful registration
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();
    const res = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'granted',
      isPushSupported: true,
      registrationState: { token: 'fcm_live_token_1234567890abcdef', userId: 'cust_alice' },
      platform: 'android',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(res, { shouldShow: false, reason: 'already_registered' });

    // If permission is granted but another user logs in on shared browser, their registration check stays distinct
    const resBob = evaluatePushOnboardingEligibility({
      userId: 'cust_bob',
      browserPermission: 'granted',
      isPushSupported: true,
      registrationState: { token: 'fcm_live_token_1234567890abcdef', userId: 'cust_alice' },
      platform: 'android',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(resBob, { shouldShow: true, mode: 'sync_needed' });
    console.log('  ✓ Test 3: Registered user never re-prompted; shared device tracks registration per userId');
  }

  // -------------------------------------------------------------------------
  // 4. Dismissal persists on device across subsequent logins
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();
    savePushInviteState(
      'cust_alice',
      {
        status: 'dismissed',
        permissionAtAction: 'default',
        updatedAt: '2026-11-23T11:00:00.000Z',
      },
      storage
    );

    const stored = getPushInviteDismissalState('cust_alice', storage);
    assert.strictEqual(stored?.status, 'dismissed');
    assert.ok(storage.getItem(`${PUSH_ONBOARDING_STORAGE_PREFIX}cust_alice`));

    const nextLoginRes = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'default',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(nextLoginRes, { shouldShow: false, reason: 'dismissed' });

    // Separate customer on same device has independent state
    const bobRes = evaluatePushOnboardingEligibility({
      userId: 'cust_bob',
      browserPermission: 'default',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(bobRes, { shouldShow: true, mode: 'invite' });
    console.log('  ✓ Test 4: Per-device dismissal prevents repeated prompts on subsequent logins');
  }

  // -------------------------------------------------------------------------
  // 5. Denied permission experience (shows guidance, never loops OS prompt)
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();
    const deniedRes = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'denied',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(deniedRes, { shouldShow: true, mode: 'denied' });

    // Confirm PushNotificationService does NOT call requestNotificationPermissionFn when denied
    let requestedCount = 0;
    const deniedSvc = new PushNotificationService({
      isSupportedFn: async () => true,
      getNotificationPermissionFn: () => 'denied',
      requestNotificationPermissionFn: async () => {
        requestedCount += 1;
        return 'denied';
      },
    });
    const denyAttempt = await deniedSvc.requestPushPermission('cust_alice');
    assert.strictEqual(denyAttempt.status, 'denied');
    assert.strictEqual(requestedCount, 0);

    // Genuine 'denied' browser permission enters denied guidance mode
    const genuineDenied = resolvePushFailureState({
      result: { status: 'denied', error: 'Failed to acquire notification token.' },
      actualPermission: 'denied',
      platform: 'desktop',
      isStandalone: false,
    });
    assert.deepStrictEqual(genuineDenied, { mode: 'denied', feedbackError: null });

    // Token acquisition failure when browser permission is actually 'granted' must show sync_needed (never denied)
    const grantedTokenError = resolvePushFailureState({
      result: { status: 'denied', error: 'Messaging: Missing VAPID key.' },
      actualPermission: 'granted',
      platform: 'desktop',
      isStandalone: false,
    });
    assert.deepStrictEqual(grantedTokenError, {
      mode: 'sync_needed',
      feedbackError: 'Messaging: Missing VAPID key.',
    });

    // Token acquisition failure when browser permission is 'default' must stay in invite mode with setup error
    const defaultTokenError = resolvePushFailureState({
      result: { status: 'denied', error: 'Failed to acquire notification token.' },
      actualPermission: 'default',
      platform: 'desktop',
      isStandalone: false,
    });
    assert.deepStrictEqual(defaultTokenError, {
      mode: 'invite',
      feedbackError: 'Failed to acquire notification token.',
    });

    console.log('  ✓ Test 5: Denied permission shows browser-settings guidance without triggering prompt; token errors respect actual Notification.permission');
  }

  // -------------------------------------------------------------------------
  // 6 & 7. iOS PWA, unsupported browser, overlay suppression, and Bell UI invariants
  // -------------------------------------------------------------------------
  {
    const storage = new InMemoryStorage();
    const iosBrowserRes = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'default',
      isPushSupported: false,
      registrationState: { token: null, userId: null },
      platform: 'ios',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(iosBrowserRes, { shouldShow: true, mode: 'ios_pwa_required' });

    const iosStandaloneRes = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'default',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'ios',
      isStandalone: true,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(iosStandaloneRes, { shouldShow: true, mode: 'invite' });

    const unsupportedRes = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'unsupported',
      isPushSupported: false,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: false,
      storage,
    });
    assert.deepStrictEqual(unsupportedRes, { shouldShow: true, mode: 'unsupported' });

    const overlaySuppressed = evaluatePushOnboardingEligibility({
      userId: 'cust_alice',
      browserPermission: 'default',
      isPushSupported: true,
      registrationState: { token: null, userId: null },
      platform: 'desktop',
      isStandalone: false,
      hasBlockingOverlay: true,
      storage,
    });
    assert.deepStrictEqual(overlaySuppressed, { shouldShow: false, reason: 'blocked_by_overlay' });

    // Source verification for bell visibility, responsive modal layout, and existing integrations
    const layoutSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/DashboardLayout.tsx'), 'utf8');
    const modalSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/NotificationOnboardingModal.tsx'), 'utf8');
    const settingsSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/NotificationSettingsModal.tsx'), 'utf8');
    const drawerSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/NotificationsDrawer.tsx'), 'utf8');
    const navbarSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/public/PublicNavbar.tsx'), 'utf8');
    const heroSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/public/HeroSection.tsx'), 'utf8');
    const pwaBtnSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/pwa/PWAInstallButton.tsx'), 'utf8');
    const { evaluatePWAInstallVisibility } = await import('./src/hooks/usePWAInstall');

    // Bell always rendered in header & sidebar regardless of push permission
    assert.ok(layoutSrc.includes('id="header-notifications-btn"'));
    assert.ok(layoutSrc.includes('id="sidebar-notifications-btn"'));
    assert.ok(layoutSrc.includes('unreadNotifsCount'));
    assert.ok(layoutSrc.includes('<NotificationOnboardingModal'));
    assert.ok(layoutSrc.includes('<NotificationsDrawer'));
    assert.ok(layoutSrc.includes('onOpenNotificationSettings'));

    // Drawer preserves transaction-detail navigation AND surfaces Preferences + push callout on mobile & desktop
    assert.ok(drawerSrc.includes('handleNavigateNotification'));
    assert.ok(drawerSrc.includes('resolveNavigationTarget'));
    assert.ok(drawerSrc.includes('id="drawer-enable-push-callout"'));
    assert.ok(drawerSrc.includes('id="drawer-enable-push-btn"'));
    assert.ok(drawerSrc.includes('<span>Preferences</span>'));
    assert.ok(!drawerSrc.includes('<span className="hidden sm:inline">Preferences</span>'));

    // Onboarding modal: privacy sentence removed, direct activation + verified success + denied retry + iOS 4-step guidance + no Open Notification Center redirect
    assert.ok(!modalSrc.includes('Privacy protected: Monvera alerts never include full bank account numbers'));
    assert.ok(!modalSrc.includes('ShieldCheck'));
    assert.ok(!modalSrc.includes('Open Notification Center'));
    assert.ok(modalSrc.includes('Enable Notifications'));
    assert.ok(modalSrc.includes('notification-onboarding-success'));
    assert.ok(modalSrc.includes('notification-onboarding-retry-btn'));
    assert.ok(modalSrc.includes('Check Permission Again'));
    assert.ok(modalSrc.includes('Continue to Dashboard'));
    assert.ok(modalSrc.includes('max-h-[90vh]'));
    assert.ok(modalSrc.includes('flex-col-reverse sm:flex-row'));
    assert.ok(modalSrc.includes('Not Now'));
    assert.ok(modalSrc.includes('text-slate-950 font-extrabold'));
    assert.ok(modalSrc.includes('Add to Home Screen'));

    // Settings modal validates token & error before showing success
    assert.ok(settingsSrc.includes('result.status === \'granted\' && result.token && !result.error'));
    assert.ok(settingsSrc.includes('monvera_push_status_updated'));

    // PWA Download Monvera App button & universal platform visibility
    assert.strictEqual(evaluatePWAInstallVisibility({ isStandalone: false, isInstalled: false }), true);
    assert.strictEqual(evaluatePWAInstallVisibility({ isStandalone: true, isInstalled: false }), false);
    assert.strictEqual(evaluatePWAInstallVisibility({ isStandalone: false, isInstalled: true }), false);

    assert.ok(navbarSrc.includes('label="Download Monvera App"'));
    assert.ok(!navbarSrc.includes('xs:inline') && !navbarSrc.includes('xs:hidden'));
    assert.ok(navbarSrc.includes('id="monvera-translator-bar"'));
    assert.ok(heroSrc.includes('label="Download Monvera App"'));
    assert.ok(heroSrc.includes('sublabel="Enjoy easier access to your banking."'));

    assert.ok(pwaBtnSrc.includes('Desktop Browser App Setup'));
    assert.ok(pwaBtnSrc.includes('iPhone & iPad Home Screen Setup'));
    assert.ok(pwaBtnSrc.includes('Android Mobile App Setup'));
    assert.ok(pwaBtnSrc.includes('Add to Dock'));
    assert.ok(pwaBtnSrc.includes('Cast, save, and share'));
    assert.ok(pwaBtnSrc.includes('Open in Chrome First'));
    assert.ok(pwaBtnSrc.includes('Open in Safari First'));

    console.log('  ✓ Tests 6 & 7: Direct activation, denied retry, iOS/Android/Desktop PWA, bold text, and privacy removal verified');
  }

  console.log('\nALL NOTIFICATION ONBOARDING, ACTIVATION, AND UNIVERSAL PWA TESTS PASSED.');
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
