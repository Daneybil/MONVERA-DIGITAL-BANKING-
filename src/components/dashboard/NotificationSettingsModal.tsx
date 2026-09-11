import React, { useState, useEffect } from 'react';
import {
  Bell,
  Smartphone,
  Mail,
  ShieldCheck,
  Check,
  AlertCircle,
  X,
  Radio,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { firestoreSync } from '../../services/firestoreSync';
import { pushNotificationService, PushRegistrationResult } from '../../services/pushNotificationService';
import { NotificationPreferences } from '../../types';

interface NotificationSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NotificationSettingsModal: React.FC<NotificationSettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentUser } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    userId: currentUser?.id || '',
    pushEnabled: true,
    smsEnabled: true,
    emailEnabled: true,
    transactionAlerts: true,
    securityAlerts: true,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [pushStatus, setPushStatus] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default');
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  // Check initial browser push permission state
  useEffect(() => {
    if (!isOpen) return;

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPushStatus(Notification.permission as any);
    } else {
      setPushStatus('unsupported');
    }

    if (currentUser?.id) {
      setIsLoading(true);
      firestoreSync
        .getNotificationPreferences(currentUser.id)
        .then((prefs) => {
          setPreferences(prefs);
        })
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, currentUser?.id]);

  if (!isOpen) return null;

  const handleToggle = (key: keyof NotificationPreferences) => {
    if (key === 'securityAlerts') return; // Enforced security protection
    setPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSavePreferences = async () => {
    if (!currentUser?.id) return;
    setIsSaving(true);
    try {
      await firestoreSync.saveNotificationPreferences(currentUser.id, preferences);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to save notification preferences:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRequestPushPermission = async () => {
    if (!currentUser?.id) return;
    setPushMessage(null);

    const result: PushRegistrationResult = await pushNotificationService.requestPushPermission(currentUser.id);
    setPushStatus(result.status);

    if (result.status === 'granted') {
      setPushMessage('Browser push notifications enabled and linked to your Monvera account.');
      setPreferences((prev) => ({ ...prev, pushEnabled: true }));
      await firestoreSync.saveNotificationPreferences(currentUser.id, { pushEnabled: true });
    } else if (result.status === 'denied') {
      setPushMessage('Notification permission was blocked in your browser settings. Please click the lock icon in your address bar to enable.');
    } else if (result.status === 'unsupported') {
      setPushMessage('Web Push is not supported in this browser or iframe container.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl rounded-2xl bg-white border-2 border-slate-300 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-6 bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">Notification Settings & Multi-Channel Alerts</h2>
              <p className="text-xs text-slate-400 font-medium">Configure real-time delivery channels for account activity</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm font-semibold">
              Loading your preferences...
            </div>
          ) : (
            <>
              {/* Transaction Alerts Master Switch */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-sky-100 text-sky-700 mt-0.5">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">Transaction Alerts</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Receive alerts when money is received from Bennett Johnson, peers, or external disbursements.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle('transactionAlerts')}
                  className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out shrink-0 ${
                    preferences.transactionAlerts ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      preferences.transactionAlerts ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Push Notifications Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700 mt-0.5">
                      <Bell className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-900">Push Notifications (FCM / Web Push)</span>
                        <span
                          className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                            pushStatus === 'granted'
                              ? 'bg-emerald-100 text-emerald-800'
                              : pushStatus === 'denied'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {pushStatus === 'granted' ? 'Browser Permitted' : pushStatus === 'denied' ? 'Blocked in Browser' : 'Requires Permission'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Native desktop and mobile banners when transfers or payments settle.
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggle('pushEnabled')}
                    className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out shrink-0 ${
                      preferences.pushEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                    }`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                        preferences.pushEnabled ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Push Registration Action */}
                {pushStatus !== 'granted' && (
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500 font-medium">Device push requires active browser permission:</span>
                    <button
                      type="button"
                      onClick={handleRequestPushPermission}
                      className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer transition-colors flex items-center gap-1"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>Enable Browser Push</span>
                    </button>
                  </div>
                )}

                {pushMessage && (
                  <div className="p-2.5 rounded-lg bg-sky-50 text-sky-900 text-xs font-medium flex items-center gap-2 border border-sky-200">
                    <AlertCircle className="w-4 h-4 shrink-0 text-sky-700" />
                    <span>{pushMessage}</span>
                  </div>
                )}
              </div>

              {/* SMS Notifications Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-amber-100 text-amber-700 mt-0.5">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">SMS Notifications</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Instant mobile text credit and debit alerts.
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      Dest: {currentUser?.phone || 'No mobile phone registered on profile'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle('smsEnabled')}
                  className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out shrink-0 ${
                    preferences.smsEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      preferences.smsEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Transactional Email Card */}
              <div className="p-4 rounded-xl border border-slate-200 bg-white flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-purple-100 text-purple-700 mt-0.5">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">Transactional Email</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Official Monvera luxury statements, receipts, and credit alerts.
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-1">
                      Dest: {currentUser?.email || 'Registered account email'}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleToggle('emailEnabled')}
                  className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-200 ease-in-out shrink-0 ${
                    preferences.emailEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      preferences.emailEnabled ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Security Alerts (Locked / Enforced) */}
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex items-start justify-between gap-4 opacity-90">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-emerald-100 text-emerald-800 mt-0.5">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-black text-slate-900">Security & Authentication Alerts</span>
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                        FDIC Protected
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Critical notices for suspicious activity, password changes, and 2FA verification cannot be disabled.
                    </div>
                  </div>
                </div>

                <div className="w-12 h-6 flex items-center rounded-full p-1 bg-emerald-600/70 cursor-not-allowed shrink-0">
                  <div className="bg-white w-4 h-4 rounded-full shadow-md transform translate-x-6" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-100 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-medium">
            Changes apply in real time across all linked devices
          </span>
          <div className="flex items-center gap-2">
            {saveSuccess && (
              <span className="text-xs font-bold text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> Preferences Saved!
              </span>
            )}
            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={isSaving}
              className="px-5 py-2 text-xs font-black rounded-xl bg-slate-950 hover:bg-slate-900 text-white cursor-pointer transition-colors flex items-center gap-1.5 shadow-sm"
            >
              {isSaving ? (
                <span>Saving...</span>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  <span>Save Preferences</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
