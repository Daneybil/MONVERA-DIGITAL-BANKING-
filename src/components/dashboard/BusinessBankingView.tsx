import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../services/api';
import confetti from 'canvas-confetti';
import {
  Building2,
  Users,
  Send,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  ArrowRight,
  Landmark,
  ShieldCheck,
} from 'lucide-react';

export const BusinessBankingView: React.FC = () => {
  const { currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  
  const [payrollRows, setPayrollRows] = useState([
    { name: 'Marcus Vance', role: 'Lead Architect', amount: '8500', account: '1088492015' },
    { name: 'Sophia Sterling', role: 'Treasury Analyst', amount: '6200', account: '1099281726' },
    { name: 'Devin Cole', role: 'Operations Lead', amount: '5400', account: '1045827391' },
  ]);

  const [isDisbursing, setIsDisbursing] = useState(false);
  const [payrollSuccess, setPayrollSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!currentUser || !balanceMetrics) return null;

  const totalPayroll = payrollRows.reduce((acc, row) => acc + (parseFloat(row.amount) || 0), 0);

  const handleDisbursePayroll = async () => {
    if (totalPayroll > balanceMetrics.checkingBalance) {
      setErrorMsg(`Insufficient checking balance ($${balanceMetrics.checkingBalance.toLocaleString()}) to execute batch payroll ($${totalPayroll.toLocaleString()}).`);
      return;
    }

    setErrorMsg(null);
    setIsDisbursing(true);

    try {
      // Execute payroll transfers
      for (const item of payrollRows) {
        await api.sendMonveraTransfer({
          senderUserId: currentUser.id,
          recipientAccountNumber: item.account,
          amount: parseFloat(item.amount),
          description: `Payroll Disbursement: ${item.name} (${item.role})`,
          category: 'Transfers',
        });
      }

      setPayrollSuccess(true);
      await refreshBalance();
      await refreshNotifications();
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#059669', '#10b981', '#0f172a'],
      });
    } catch (err) {
      setErrorMsg('Failed to process batch payroll disbursement.');
    } finally {
      setIsDisbursing(false);
    }
  };

  return (
    <div id="business-banking-view" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-700 font-semibold">
            <Building2 className="w-4 h-4 text-emerald-600" />
            <span>Corporate Liquidity Portal</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            Business Banking & Payroll Engine
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Automated corporate treasury, high-throughput payroll batching, and verified vendor disbursements.
          </p>
        </div>

        <span className="text-xs font-bold font-mono text-slate-700 bg-white px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-2xs">
          EIN Verified • Corporate Tier
        </span>
      </div>

      {/* Batch Payroll Processor Card */}
      <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 text-emerald-400 flex items-center justify-center font-bold">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Batch Payroll Disburser</h3>
              <p className="text-xs text-slate-500">
                Single-action batch transfer settling instantly via double-entry ledger.
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-mono text-slate-400 block">Total Payroll Sum</span>
            <span className="text-2xl font-extrabold font-mono text-slate-900">
              ${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
            </span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {payrollSuccess && (
          <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 flex items-center gap-3 animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <div>
              <div className="font-bold">Batch Payroll Successfully Executed!</div>
              <p className="text-emerald-700">All recipient accounts credited and individual transaction receipts generated.</p>
            </div>
          </div>
        )}

        {/* Payroll Table */}
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Recipient</th>
                <th className="p-3.5">Role</th>
                <th className="p-3.5">Monvera Account</th>
                <th className="p-3.5 text-right">Disbursement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono">
              {payrollRows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-3.5 font-sans font-bold text-slate-900">{row.name}</td>
                  <td className="p-3.5 font-sans text-slate-500">{row.role}</td>
                  <td className="p-3.5 text-slate-700">{row.account}</td>
                  <td className="p-3.5 text-right font-bold text-slate-900">
                    ${parseFloat(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleDisbursePayroll}
            disabled={isDisbursing}
            className="py-3.5 px-8 rounded-xl font-bold text-sm text-white bg-slate-900 hover:bg-slate-800 transition-all shadow-md flex items-center gap-2 disabled:opacity-50"
          >
            <span>{isDisbursing ? 'Executing Batch Transfers...' : 'Authorize Batch Payroll'}</span>
            <ArrowRight className="w-4 h-4 text-emerald-400" />
          </button>
        </div>
      </div>

    </div>
  );
};
