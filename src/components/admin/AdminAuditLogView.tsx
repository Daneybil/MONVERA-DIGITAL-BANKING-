import React, { useState } from 'react';
import { AdminAuditLog } from '../../types';
import {
  ShieldCheck,
  Search,
  Download,
  Filter,
  Clock,
  User,
  Activity,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface AdminAuditLogViewProps {
  auditLogs: AdminAuditLog[];
  onRefreshData?: () => Promise<void>;
}

export const AdminAuditLogView: React.FC<AdminAuditLogViewProps> = ({
  auditLogs,
  onRefreshData,
}) => {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  const filteredLogs = auditLogs.filter((log) => {
    const term = search.toLowerCase();
    const matchesSearch =
      log.action.toLowerCase().includes(term) ||
      log.adminName.toLowerCase().includes(term) ||
      (log.targetUserId && log.targetUserId.toLowerCase().includes(term)) ||
      (log.reason && log.reason.toLowerCase().includes(term)) ||
      (log.ipAddress && log.ipAddress.includes(term));

    const matchesAction = actionFilter === 'ALL' || log.action === actionFilter;

    return matchesSearch && matchesAction;
  });

  const exportAuditLogCsv = () => {
    const headers = ['Timestamp', 'Log ID', 'Admin Name', 'Action', 'Target User ID', 'Reason', 'IP Address'];
    const rows = filteredLogs.map((l) => [
      new Date(l.timestamp).toISOString(),
      l.id,
      `"${l.adminName.replace(/"/g, '""')}"`,
      l.action,
      l.targetUserId || '',
      `"${(l.reason || '').replace(/"/g, '""')}"`,
      l.ipAddress || '127.0.0.1',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `monvera_compliance_audit_ledger_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Immutable Governance & Audit Ledger</h2>
          <p className="text-xs text-slate-500">
            Append-only chronological record of all administrative actions, permissions, and compliance events
          </p>
        </div>

        <button
          onClick={exportAuditLogCsv}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold transition-colors flex items-center gap-2 shadow-xs"
        >
          <Download className="w-4 h-4" /> Export Audit Log (.CSV)
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search audit trail by administrator, target user, action, or justification..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="text-xs px-3 py-2 rounded-xl border border-slate-200 focus:outline-hidden text-slate-900 bg-white font-medium"
          >
            <option value="ALL">All Actions</option>
            <option value="KYC_APPROVED">KYC Approved</option>
            <option value="KYC_REJECTED">KYC Rejected</option>
            <option value="ACCOUNT_FROZEN">Account Frozen</option>
            <option value="ACCOUNT_UNFROZEN">Account Unfrozen</option>
            <option value="TRANSACTION_STATUS_UPDATED">Transaction Status Changed</option>
            <option value="DEV_LIQUIDITY_DISBURSED">Sandbox Liquidity Disbursed</option>
            <option value="DEV_POOL_REPLENISHED">Sandbox Pool Replenished</option>
          </select>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="p-4 font-semibold">Timestamp</th>
                <th className="p-4 font-semibold">Administrator</th>
                <th className="p-4 font-semibold">Administrative Action</th>
                <th className="p-4 font-semibold">Affected Target Entity</th>
                <th className="p-4 font-semibold">Compliance Justification / Reason</th>
                <th className="p-4 font-semibold">IP Address</th>
                <th className="p-4 font-semibold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400">
                    No audit records match your query.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Timestamp */}
                    <td className="p-4 text-slate-500 whitespace-nowrap">
                      <div className="font-medium text-slate-800">
                        {new Date(log.timestamp).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        {new Date(log.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </div>
                    </td>

                    {/* Admin */}
                    <td className="p-4 whitespace-nowrap">
                      <div className="font-bold text-slate-900">{log.adminName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {log.adminId || 'SUPER_ADMIN'}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="p-4">
                      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-900 text-amber-400 font-mono">
                        {log.action}
                      </span>
                    </td>

                    {/* Target User */}
                    <td className="p-4 font-mono text-slate-700 whitespace-nowrap">
                      {log.targetUserId ? (
                        <span className="px-2 py-0.5 rounded-sm bg-slate-100 border border-slate-200">
                          {log.targetUserId}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    {/* Justification */}
                    <td className="p-4 max-w-xs text-slate-700">
                      {log.reason || 'Routine compliance operation'}
                    </td>

                    {/* IP */}
                    <td className="p-4 font-mono text-slate-500 whitespace-nowrap">
                      {log.ipAddress || '127.0.0.1'}
                    </td>

                    {/* Status */}
                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Executed
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
