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
  FileText,
  CreditCard,
  HelpCircle,
  Trash2,
  DollarSign,
  Briefcase,
  Copy,
  Check,
  ArrowRight,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

interface StaffMember {
  id: string;
  name: string;
  role: string;
  account: string;
  amount: number;
}

interface InvoiceItem {
  id: string;
  clientName: string;
  serviceName: string;
  amount: number;
  dueDate: string;
  status: 'PAID' | 'PENDING';
  createdDate: string;
}

export const BusinessBankingView: React.FC = () => {
  const { currentUser, balanceMetrics, refreshBalance, refreshNotifications } = useAuth();
  
  // Tab Selection: 'payroll' | 'invoices' | 'cards' | 'guide'
  const [activeTab, setActiveTab] = useState<'payroll' | 'invoices' | 'cards' | 'guide'>('payroll');

  // Staff Payroll State
  const [staffList, setStaffList] = useState<StaffMember[]>([
    { id: '1', name: 'Marcus Vance', role: 'Lead Developer', account: '1088492015', amount: 4500 },
    { id: '2', name: 'Sophia Sterling', role: 'Account Manager', account: '1099281726', amount: 3800 },
    { id: '3', name: 'Devin Cole', role: 'Marketing Lead', account: '1045827391', amount: 3200 },
  ]);

  // Form to add a new staff member
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffRole, setNewStaffRole] = useState('');
  const [newStaffAccount, setNewStaffAccount] = useState('');
  const [newStaffAmount, setNewStaffAmount] = useState('');

  // Payroll execution state
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [payrollSuccessMsg, setPayrollSuccessMsg] = useState<string | null>(null);
  const [payrollErrorMsg, setPayrollErrorMsg] = useState<string | null>(null);

  // Invoicing State
  const [invoices, setInvoices] = useState<InvoiceItem[]>([
    {
      id: 'INV-2026-001',
      clientName: 'Acme Global Corp',
      serviceName: 'Q3 Enterprise Consulting Services',
      amount: 14500,
      dueDate: '2026-09-15',
      status: 'PAID',
      createdDate: '2026-08-10',
    },
    {
      id: 'INV-2026-002',
      clientName: 'Starlight Media LLC',
      serviceName: 'Brand Strategy & Technical Advisory',
      amount: 8200,
      dueDate: '2026-09-01',
      status: 'PENDING',
      createdDate: '2026-08-18',
    },
  ]);

  const [showNewInvoiceModal, setShowNewInvoiceModal] = useState(false);
  const [clientName, setClientName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [dueDate, setDueDate] = useState('2026-09-30');
  const [copiedInvoiceId, setCopiedInvoiceId] = useState<string | null>(null);

  if (!currentUser || !balanceMetrics) return null;

  const totalPayroll = staffList.reduce((acc, row) => acc + (row.amount || 0), 0);
  const totalPendingInvoices = invoices.filter(i => i.status === 'PENDING').reduce((acc, i) => acc + i.amount, 0);

  // Add staff member
  const handleAddStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStaffName || !newStaffRole || !newStaffAmount) return;

    const newMember: StaffMember = {
      id: Date.now().toString(),
      name: newStaffName,
      role: newStaffRole,
      account: newStaffAccount || `10${Math.floor(10000000 + Math.random() * 90000000)}`,
      amount: parseFloat(newStaffAmount) || 0,
    };

    setStaffList([...staffList, newMember]);
    setNewStaffName('');
    setNewStaffRole('');
    setNewStaffAccount('');
    setNewStaffAmount('');
    setShowAddStaffModal(false);
  };

  // Remove staff member
  const handleRemoveStaff = (id: string) => {
    setStaffList(staffList.filter(s => s.id !== id));
  };

  // Pay all staff
  const handlePayStaff = async () => {
    if (staffList.length === 0) {
      setPayrollErrorMsg('Please add at least one staff member before executing payroll.');
      return;
    }

    if (totalPayroll > balanceMetrics.checkingBalance) {
      setPayrollErrorMsg(`Insufficient checking balance ($${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}). You need $${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })} to pay your staff.`);
      return;
    }

    setPayrollErrorMsg(null);
    setIsDisbursing(true);

    try {
      // Execute transfers
      for (const item of staffList) {
        await api.sendMonveraTransfer({
          senderUserId: currentUser.id,
          recipientAccountNumber: item.account,
          amount: item.amount,
          description: `Staff Salary Payment: ${item.name} (${item.role})`,
          category: 'Transfers',
        });
      }

      setPayrollSuccessMsg(`Success! Paid $${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })} to all ${staffList.length} team members.`);
      await refreshBalance();
      await refreshNotifications();

      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#059669', '#10b981', '#0f172a'],
      });
    } catch {
      setPayrollErrorMsg('Failed to process staff payment. Please check your account balance and try again.');
    } finally {
      setIsDisbursing(false);
    }
  };

  // Create Invoice
  const handleCreateInvoice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientName || !serviceName || !invoiceAmount) return;

    const newInv: InvoiceItem = {
      id: `INV-2026-00${invoices.length + 1}`,
      clientName,
      serviceName,
      amount: parseFloat(invoiceAmount) || 0,
      dueDate: dueDate || '2026-09-30',
      status: 'PENDING',
      createdDate: new Date().toISOString().split('T')[0],
    };

    setInvoices([newInv, ...invoices]);
    setClientName('');
    setServiceName('');
    setInvoiceAmount('');
    setShowNewInvoiceModal(false);
  };

  const handleCopyInvoiceLink = (id: string) => {
    navigator.clipboard?.writeText(`https://monvera.bank/pay/${id}`);
    setCopiedInvoiceId(id);
    setTimeout(() => setCopiedInvoiceId(null), 2500);
  };

  const handleMarkInvoicePaid = (id: string) => {
    setInvoices(invoices.map(inv => inv.id === id ? { ...inv, status: 'PAID' } : inv));
  };

  return (
    <div id="business-banking-view" className="space-y-6 sm:space-y-8 animate-in fade-in duration-150">
      
      {/* --- Layman Friendly Header --- */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white p-6 sm:p-8 rounded-3xl border-2 border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold">
              <Building2 className="w-3.5 h-3.5" />
              <span>Simple Business Banking</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Business & Company Banking
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Everything you need to run your business finances easily: pay your workers in 1 click, send professional invoices to get paid by clients, and manage company spending.
            </p>
          </div>

          <div className="flex flex-col items-start sm:items-end bg-slate-950/80 p-4 rounded-2xl border border-slate-800 shrink-0">
            <span className="text-[10px] uppercase font-mono font-bold text-slate-400">Available Business Funds</span>
            <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400">
              ${balanceMetrics.checkingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
            </span>
          </div>
        </div>

        {/* 4 Summary Highlight Tiles (Layman Terms) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800">
          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-750">
            <div className="text-[11px] text-slate-400 font-medium">1. Business Checking</div>
            <div className="text-base font-black text-white mt-0.5">Active & Liquid</div>
          </div>
          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-750">
            <div className="text-[11px] text-slate-400 font-medium">2. Monthly Staff Pay</div>
            <div className="text-base font-black text-emerald-400 mt-0.5">${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-750">
            <div className="text-[11px] text-slate-400 font-medium">3. Unpaid Invoices</div>
            <div className="text-base font-black text-amber-400 mt-0.5">${totalPendingInvoices.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-750">
            <div className="text-[11px] text-slate-400 font-medium">4. Company Debit Cards</div>
            <div className="text-base font-black text-cyan-400 mt-0.5">Visa Infinite Active</div>
          </div>
        </div>
      </div>

      {/* --- Simple Navigation Tabs for Business Tools --- */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-200/80 rounded-2xl border border-slate-300">
        <button
          onClick={() => setActiveTab('payroll')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'payroll'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
          }`}
        >
          <Users className="w-4 h-4 text-emerald-400" />
          <span>Pay Staff (Payroll)</span>
        </button>

        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'invoices'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4 text-cyan-400" />
          <span>Send Invoices (Get Paid)</span>
        </button>

        <button
          onClick={() => setActiveTab('cards')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'cards'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
          }`}
        >
          <CreditCard className="w-4 h-4 text-amber-400" />
          <span>Company Cards</span>
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`flex-1 min-w-[140px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 transition-all cursor-pointer ${
            activeTab === 'guide'
              ? 'bg-slate-900 text-white shadow-md'
              : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100'
          }`}
        >
          <HelpCircle className="w-4 h-4 text-emerald-400" />
          <span>Simple Guide (FAQ)</span>
        </button>
      </div>

      {/* ========================================================
          TAB 1: STAFF PAYROLL (PAY WORKERS WITH 1 CLICK)
      ======================================================== */}
      {activeTab === 'payroll' && (
        <div className="space-y-6">
          <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-6">
            
            {/* Header of Section */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" />
                  <span>Pay Your Team & Staff Members</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  Add the people who work for your company, set their salary or contractor fee, and pay all of them with one button.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowAddStaffModal(true)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-bold flex items-center gap-2 border border-slate-300 transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4 text-emerald-600" />
                  <span>Add Staff Member</span>
                </button>

                <button
                  onClick={handlePayStaff}
                  disabled={isDisbursing || staffList.length === 0}
                  className="py-2.5 px-6 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 shadow-md transition-all cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{isDisbursing ? 'Sending Payments...' : 'Pay All Staff Now'}</span>
                </button>
              </div>
            </div>

            {/* Notifications */}
            {payrollErrorMsg && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs sm:text-sm text-red-800 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Payment Problem</div>
                  <div>{payrollErrorMsg}</div>
                </div>
              </div>
            )}

            {payrollSuccessMsg && (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 text-xs sm:text-sm text-emerald-900 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Staff Payment Complete!</div>
                  <div>{payrollSuccessMsg}</div>
                </div>
              </div>
            )}

            {/* Staff List Table */}
            <div className="overflow-x-auto rounded-2xl border-2 border-slate-200">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-slate-100 border-b-2 border-slate-200 text-slate-700 font-extrabold uppercase text-[11px] tracking-wider">
                  <tr>
                    <th className="p-4">Staff Name</th>
                    <th className="p-4">Job Role / Title</th>
                    <th className="p-4">Monvera Account #</th>
                    <th className="p-4 text-right">Pay Amount ($)</th>
                    <th className="p-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffList.map((staff) => (
                    <tr key={staff.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-bold text-slate-900 flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-slate-900 text-emerald-400 font-black text-xs flex items-center justify-center">
                          {staff.name.charAt(0)}
                        </div>
                        <span>{staff.name}</span>
                      </td>
                      <td className="p-4 text-slate-600 font-medium">{staff.role}</td>
                      <td className="p-4 font-mono font-bold text-slate-700">{staff.account}</td>
                      <td className="p-4 text-right font-mono font-black text-emerald-700 text-sm sm:text-base">
                        ${staff.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center">
                        <button
                          onClick={() => handleRemoveStaff(staff.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          title="Remove from staff list"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Total Row */}
            <div className="flex flex-col sm:flex-row items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-200 gap-3">
              <div className="text-xs sm:text-sm text-slate-600">
                Total staff members: <strong className="text-slate-900">{staffList.length} people</strong>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase font-bold text-slate-500 font-mono">Total To Disburse:</span>
                <span className="text-xl sm:text-2xl font-black font-mono text-slate-950">
                  ${totalPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                </span>
              </div>
            </div>

          </div>

          {/* Add Staff Modal */}
          {showAddStaffModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
              <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border-2 border-slate-300 shadow-2xl space-y-5 animate-in zoom-in-95">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-black text-slate-900">Add Staff Member</h4>
                  <button
                    onClick={() => setShowAddStaffModal(false)}
                    className="text-slate-400 hover:text-slate-700 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleAddStaff} className="space-y-4 text-xs sm:text-sm">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. John Doe"
                      value={newStaffName}
                      onChange={(e) => setNewStaffName(e.target.value)}
                      required
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Job Role / Title</label>
                    <input
                      type="text"
                      placeholder="e.g. Graphic Designer"
                      value={newStaffRole}
                      onChange={(e) => setNewStaffRole(e.target.value)}
                      required
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Monvera Account Number (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 1088492015"
                      value={newStaffAccount}
                      onChange={(e) => setNewStaffAccount(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Pay Amount ($ USD)</label>
                    <input
                      type="number"
                      placeholder="e.g. 3500"
                      value={newStaffAmount}
                      onChange={(e) => setNewStaffAmount(e.target.value)}
                      required
                      min="1"
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono font-bold"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowAddStaffModal(false)}
                      className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                    >
                      Save Staff Member
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          TAB 2: SEND INVOICES (GET PAID BY CLIENTS)
      ======================================================== */}
      {activeTab === 'invoices' && (
        <div className="space-y-6">
          <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-6">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-cyan-600" />
                  <span>Send Invoices to Clients (Get Paid)</span>
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
                  Create a simple invoice for your customer or client. They can pay you directly to your Monvera business account.
                </p>
              </div>

              <button
                onClick={() => setShowNewInvoiceModal(true)}
                className="py-2.5 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-extrabold flex items-center gap-2 shadow-md transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>Create New Invoice</span>
              </button>
            </div>

            {/* Invoices List */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="p-5 rounded-2xl bg-slate-50 border-2 border-slate-250 space-y-4 hover:border-slate-350 transition-all shadow-xs"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-mono font-bold text-slate-500">{inv.id}</span>
                      <h4 className="text-base font-black text-slate-900">{inv.clientName}</h4>
                    </div>
                    <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-full ${
                      inv.status === 'PAID'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-amber-100 text-amber-800 border border-amber-300'
                    }`}>
                      {inv.status === 'PAID' ? '✓ Paid' : '⏳ Pending Payment'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600">
                    <div className="font-semibold text-slate-800">{inv.serviceName}</div>
                    <div className="text-slate-500 mt-0.5">Due: {inv.dueDate}</div>
                  </div>

                  <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                    <div className="text-lg font-black font-mono text-slate-900">
                      ${inv.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCopyInvoiceLink(inv.id)}
                        className="py-1.5 px-3 rounded-lg bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                        title="Copy Payment Link"
                      >
                        {copiedInvoiceId === inv.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700 font-bold">Link Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-slate-500" />
                            <span>Payment Link</span>
                          </>
                        )}
                      </button>

                      {inv.status === 'PENDING' && (
                        <button
                          onClick={() => handleMarkInvoicePaid(inv.id)}
                          className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors cursor-pointer"
                        >
                          Mark Paid
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* New Invoice Modal */}
          {showNewInvoiceModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
              <div className="bg-white rounded-3xl p-6 sm:p-8 max-w-md w-full border-2 border-slate-300 shadow-2xl space-y-5 animate-in zoom-in-95">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-black text-slate-900">Create Client Invoice</h4>
                  <button
                    onClick={() => setShowNewInvoiceModal(false)}
                    className="text-slate-400 hover:text-slate-700 font-bold"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleCreateInvoice} className="space-y-4 text-xs sm:text-sm">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Client or Customer Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Apex Corporation"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      required
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Work / Service Description</label>
                    <input
                      type="text"
                      placeholder="e.g. Web Development & Security Audit"
                      value={serviceName}
                      onChange={(e) => setServiceName(e.target.value)}
                      required
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Invoice Total Amount ($ USD)</label>
                    <input
                      type="number"
                      placeholder="e.g. 5000"
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                      required
                      min="1"
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono font-bold"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">Payment Due Date</label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-cyan-500 font-mono"
                    />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowNewInvoiceModal(false)}
                      className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold"
                    >
                      Create & Send
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          TAB 3: COMPANY DEBIT CARDS
      ======================================================== */}
      {activeTab === 'cards' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-6">
          <div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-amber-600" />
              <span>Company Expense & Debit Cards</span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Dedicated Visa cards for your business expenses, office subscriptions, and employee travel budgets.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Main Corporate Card Preview */}
            <div className="p-6 rounded-3xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-950 text-white shadow-xl space-y-6 border-2 border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider">
                  Monvera Corporate Visa
                </span>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Active
                </span>
              </div>

              <div className="space-y-1">
                <div className="text-[11px] text-slate-400 font-mono">Card Number</div>
                <div className="text-xl font-mono font-bold tracking-widest text-slate-100">
                  4829 •••• •••• 8821
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-slate-800">
                <div>
                  <div className="text-slate-400 text-[10px]">Cardholder</div>
                  <div className="font-bold text-white uppercase">{currentUser.firstName} {currentUser.lastName}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[10px]">Monthly Limit</div>
                  <div className="font-bold text-emerald-400">$50,000.00</div>
                </div>
              </div>
            </div>

            {/* Card Features List */}
            <div className="space-y-3.5 flex flex-col justify-center">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-slate-900">Zero Liability Fraud Protection</div>
                  <div className="text-xs text-slate-600">All business card payments are insured up to $1,000,000 against unauthorized charges.</div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-slate-900">Instant Virtual Card Generation</div>
                  <div className="text-xs text-slate-600">Issue instant temporary cards with set spending limits for online software subscriptions.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          TAB 4: SIMPLE GUIDE (PLAIN ENGLISH FAQ)
      ======================================================== */}
      {activeTab === 'guide' && (
        <div className="p-6 sm:p-8 rounded-3xl bg-white border-2 border-slate-200 shadow-md space-y-6">
          <div>
            <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <HelpCircle className="w-5 h-5 text-emerald-600" />
              <span>How Business Banking Works (Simple Guide)</span>
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              Frequently asked questions explained in simple, clear terms for regular business owners.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs sm:text-sm">
            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                <span>🏢 What is a Business Account?</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                It is a bank account specifically for your company or freelancing work. It keeps your business money separate from personal groceries and rent so taxes and bookkeeping are effortless.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                <span>👥 How does Staff Payroll work?</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                You enter your employees or contractors once with their pay amounts. Whenever payday comes, you click "Pay All Staff Now" and everyone gets paid instantly.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                <span>📄 How do I get paid by customers?</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Go to the "Send Invoices" tab, enter your client's name and the amount. You will get a payment link that your customer can click to pay you directly.
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="font-extrabold text-slate-900 flex items-center gap-2 text-sm sm:text-base">
                <span>💳 Can I give debit cards to my staff?</span>
              </div>
              <p className="text-slate-600 leading-relaxed">
                Yes! You can create company cards with specific monthly limits (e.g. $500 for office supplies) so employees can only spend what you authorize.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
