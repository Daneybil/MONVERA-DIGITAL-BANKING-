import React, { useState } from 'react';
import {
  Bell,
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  Clock,
  Check,
  Trash2,
  Filter,
} from 'lucide-react';

interface AdminAlert {
  id: string;
  title: string;
  message: string;
  type: 'security' | 'compliance' | 'system' | 'high_value';
  severity: 'info' | 'warning' | 'danger';
  timestamp: string;
  isRead: boolean;
}

interface AdminNotificationsViewProps {
  onRefreshData?: () => Promise<void>;
}

export const AdminNotificationsView: React.FC<AdminNotificationsViewProps> = ({
  onRefreshData,
}) => {
  const [alerts, setAlerts] = useState<AdminAlert[]>([
    {
      id: 'alt-1',
      title: 'High-Value Inflow Verification',
      message: 'A deposit of $250,000.00 was cleared via FedWire Transit for account MVB-883019284. All AML threshold checks passed.',
      type: 'high_value',
      severity: 'info',
      timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      isRead: false,
    },
    {
      id: 'alt-2',
      title: 'New KYC Regulatory Dossier Submitted',
      message: 'Alexander Wright submitted passport verification documents requiring compliance review.',
      type: 'compliance',
      severity: 'warning',
      timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
      isRead: false,
    },
    {
      id: 'alt-3',
      title: 'Rate Limit / Rapid Verification Attempt',
      message: 'Multiple 2FA authentication requests detected from IP 194.26.29.112 within 60 seconds. Guardrails applied.',
      type: 'security',
      severity: 'danger',
      timestamp: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
      isRead: true,
    },
    {
      id: 'alt-4',
      title: 'Sandbox Liquidity Pool Synchronized',
      message: 'Admin Test Liquidity Reserve was queried and verified against isolated ledger partitions.',
      type: 'system',
      severity: 'info',
      timestamp: new Date(Date.now() - 1000 * 3600 * 5).toISOString(),
      isRead: true,
    },
  ]);

  const [filter, setFilter] = useState<'all' | 'unread' | 'danger' | 'compliance'>('all');

  const markAllAsRead = () => {
    setAlerts(alerts.map((a) => ({ ...a, isRead: true })));
  };

  const toggleRead = (id: string) => {
    setAlerts(
      alerts.map((a) => (a.id === id ? { ...a, isRead: !a.isRead } : a))
    );
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'unread') return !a.isRead;
    if (filter === 'danger') return a.severity === 'danger';
    if (filter === 'compliance') return a.type === 'compliance';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Executive Compliance & Sentinel Alerts</h2>
          <p className="text-xs text-slate-500">
            Real-time AML rule triggers, high-value settlement alerts, and administrative security signals
          </p>
        </div>

        <button
          onClick={markAllAsRead}
          className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <Check className="w-4 h-4" /> Mark All as Read
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex items-center gap-2 overflow-x-auto">
        {[
          { id: 'all', label: `All Alerts (${alerts.length})` },
          { id: 'unread', label: `Unread (${alerts.filter((a) => !a.isRead).length})` },
          { id: 'compliance', label: 'Compliance & KYC' },
          { id: 'danger', label: 'High Priority / Security' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id as any)}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
              filter === f.id
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Alerts Feed */}
      <div className="space-y-3">
        {filteredAlerts.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-xs">
            No alerts matching the selected category.
          </div>
        ) : (
          filteredAlerts.map((alert) => {
            const isDanger = alert.severity === 'danger';
            const isWarning = alert.severity === 'warning';

            return (
              <div
                key={alert.id}
                onClick={() => toggleRead(alert.id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-4 shadow-xs ${
                  alert.isRead
                    ? 'bg-white border-slate-200 opacity-80'
                    : isDanger
                    ? 'bg-rose-50/70 border-rose-200'
                    : isWarning
                    ? 'bg-amber-50/70 border-amber-200'
                    : 'bg-blue-50/50 border-blue-200'
                }`}
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`p-2.5 rounded-xl shrink-0 ${
                      isDanger
                        ? 'bg-rose-600 text-white'
                        : isWarning
                        ? 'bg-amber-500 text-white'
                        : 'bg-blue-600 text-white'
                    }`}
                  >
                    {isDanger ? (
                      <ShieldAlert className="w-5 h-5" />
                    ) : isWarning ? (
                      <AlertTriangle className="w-5 h-5" />
                    ) : (
                      <Info className="w-5 h-5" />
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold text-slate-900">{alert.title}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700">
                        {alert.type.replace(/_/g, ' ')}
                      </span>
                      {!alert.isRead && (
                        <span className="w-2 h-2 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                      {alert.message}
                    </p>
                    <div className="text-[11px] text-slate-400 font-mono mt-2">
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleRead(alert.id);
                  }}
                  className="text-xs font-semibold text-slate-400 hover:text-slate-800 p-1 rounded-lg"
                >
                  {alert.isRead ? 'Mark Unread' : 'Mark Read'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
