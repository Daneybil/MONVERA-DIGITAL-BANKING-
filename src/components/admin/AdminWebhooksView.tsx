import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import {
  Webhook,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Zap,
  Terminal,
  ShieldCheck,
  RefreshCw,
  Code,
  Send,
  HelpCircle,
} from 'lucide-react';

interface AdminWebhooksViewProps {
  customers: UserProfile[];
  onRefreshData?: () => Promise<void>;
}

export const AdminWebhooksView: React.FC<AdminWebhooksViewProps> = ({
  customers,
  onRefreshData,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<{
    stripeConfigured: boolean;
    webhookSecretConfigured: boolean;
    stripeWebhookPath: string;
    incomingWebhookPath: string;
    supportedEvents: string[];
  }>({
    stripeConfigured: false,
    webhookSecretConfigured: false,
    stripeWebhookPath: '/api/stripe/webhook',
    incomingWebhookPath: '/api/webhooks/incoming',
    supportedEvents: [
      'checkout.session.completed',
      'payment_intent.succeeded',
      'charge.refunded',
    ],
  });

  // Simulator state
  const [simUserId, setSimUserId] = useState<string>('');
  const [simAmount, setSimAmount] = useState<string>('250.00');
  const [simEvent, setSimEvent] = useState<string>('checkout.session.completed');
  const [simLoading, setSimLoading] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.run.app';
  const stripeWebhookUrl = `${baseUrl}/api/stripe/webhook`;
  const incomingWebhookUrl = `${baseUrl}/api/webhooks/incoming`;

  const fetchStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/webhooks/status');
      if (res.ok) {
        const data = await res.json();
        setWebhookStatus(data);
      }
    } catch {
      // Fallback
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    if (customers.length > 0 && !simUserId) {
      setSimUserId(customers[0].id);
    }
  }, [customers]);

  const handleCopy = (text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2500);
    }
  };

  const handleSimulateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimLoading(true);
    setSimResult(null);
    try {
      const res = await fetch('/api/webhooks/test-simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: simUserId,
          amount: parseFloat(simAmount) || 100,
          eventType: simEvent,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSimResult(`Success: ${data.message}`);
        if (onRefreshData) await onRefreshData();
      } else {
        setSimResult(`Simulation error: ${data.error || 'Failed'}`);
      }
    } catch {
      setSimResult('Error dispatching test simulation to server.');
    } finally {
      setSimLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Webhook & Gateway Integration Center</h2>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-900 text-white uppercase tracking-wider">
              Production Gateway
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time settlement webhooks, signature verification, and automated event ingestion pipelines
          </p>
        </div>

        <button
          onClick={fetchStatus}
          disabled={statusLoading}
          className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 shadow-2xs flex items-center gap-2 transition-all cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${statusLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Health</span>
        </button>
      </div>

      {/* Live Endpoints & Configuration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Stripe Webhook Endpoint */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
                <Webhook className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Stripe Inbound Webhook</h3>
                <p className="text-[11px] text-slate-500">Card deposits & checkout settlement</p>
              </div>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                webhookStatus.webhookSecretConfigured
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'
              }`}
            >
              {webhookStatus.webhookSecretConfigured ? 'Signature Verified' : 'Standard / Dev Mode'}
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Live Webhook URL</label>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800 break-all">
              <span className="flex-1 select-all">{stripeWebhookUrl}</span>
              <button
                onClick={() => handleCopy(stripeWebhookUrl, 'stripe')}
                className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-600 transition-colors cursor-pointer shrink-0"
                title="Copy URL"
              >
                {copiedKey === 'stripe' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center justify-between">
              <span>Secret Env:</span>
              <span className="font-mono font-bold text-slate-800">STRIPE_WEBHOOK_SECRET</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Supported Events:</span>
              <span className="font-semibold text-slate-800">checkout.session.completed, payment_intent.succeeded</span>
            </div>
          </div>
        </div>

        {/* Custom Gateway Webhook Endpoint */}
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center font-bold">
                <Code className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Custom Banking & Partner Webhook</h3>
                <p className="text-[11px] text-slate-500">ACH, FedWire, crypto, or external ledger</p>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
              Active / Inbound
            </span>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Inbound Partner URL</label>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs text-slate-800 break-all">
              <span className="flex-1 select-all">{incomingWebhookUrl}</span>
              <button
                onClick={() => handleCopy(incomingWebhookUrl, 'incoming')}
                className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-600 transition-colors cursor-pointer shrink-0"
                title="Copy URL"
              >
                {copiedKey === 'incoming' ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 space-y-1">
            <div className="flex items-center justify-between">
              <span>Method:</span>
              <span className="font-mono font-bold text-slate-800">POST (JSON)</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Raw Buffer Signature:</span>
              <span className="font-semibold text-emerald-700">Supported (verify callback enabled)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Webhook Simulator */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-500" />
          <h3 className="text-base font-bold text-slate-900">1-Click Sandbox Webhook Test Simulator</h3>
        </div>
        <p className="text-xs text-slate-500">
          Simulate an instantaneous incoming webhook payload to verify that transactions, balances, and notifications trigger correctly across the platform.
        </p>

        <form onSubmit={handleSimulateWebhook} className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2">
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Target Customer</label>
            <select
              value={simUserId}
              onChange={(e) => setSimUserId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName} ({c.permanentAccountNumber || c.id.slice(-6)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Simulated Amount ($ USD)</label>
            <input
              type="number"
              step="0.01"
              value={simAmount}
              onChange={(e) => setSimAmount(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 font-mono font-bold text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">Event Type</label>
            <select
              value={simEvent}
              onChange={(e) => setSimEvent(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white font-mono text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10"
            >
              <option value="checkout.session.completed">checkout.session.completed</option>
              <option value="payment_intent.succeeded">payment_intent.succeeded</option>
              <option value="charge.settled">charge.settled</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={simLoading || !simUserId}
              className="w-full py-2 px-4 rounded-xl text-xs font-bold text-white bg-slate-950 hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
            >
              {simLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-amber-400" />
                  <span>Send Test Webhook</span>
                </>
              )}
            </button>
          </div>
        </form>

        {simResult && (
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{simResult}</span>
          </div>
        )}
      </div>

      {/* Complete Step-by-Step Guide */}
      <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-6">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-slate-800" />
          <h3 className="text-base font-bold text-slate-900">Complete Webhook Setup & Configuration Guide</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          {/* Step 1 */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xs">
              1
            </div>
            <h4 className="font-bold text-slate-900">Open Stripe Dashboard</h4>
            <p className="text-slate-600 leading-relaxed">
              Navigate to <strong>Developers &rarr; Webhooks</strong> in your Stripe Dashboard (either in Test or Live mode).
            </p>
            <div className="pt-1">
              <a
                href="https://dashboard.stripe.com/webhooks"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
              >
                <span>Go to Stripe Webhooks</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xs">
              2
            </div>
            <h4 className="font-bold text-slate-900">Add Endpoint & Select Events</h4>
            <p className="text-slate-600 leading-relaxed">
              Click <strong>&quot;Add endpoint&quot;</strong> and paste your live webhook URL:
            </p>
            <div className="p-2 rounded bg-white border border-slate-200 font-mono text-[10px] break-all text-slate-800">
              {stripeWebhookUrl}
            </div>
            <p className="text-slate-500 text-[11px]">
              Select <strong>checkout.session.completed</strong> and <strong>payment_intent.succeeded</strong>.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
            <div className="w-6 h-6 rounded-full bg-slate-900 text-white font-bold flex items-center justify-center text-xs">
              3
            </div>
            <h4 className="font-bold text-slate-900">Copy Signing Secret</h4>
            <p className="text-slate-600 leading-relaxed">
              Reveal your <strong>Signing secret</strong> (starts with <code className="font-mono text-[10px] bg-white px-1 py-0.5 rounded border">whsec_...</code>) and save it in your project settings / environment variables:
            </p>
            <div className="p-2 rounded bg-white border border-slate-200 font-mono text-[10px] text-slate-800">
              STRIPE_WEBHOOK_SECRET=whsec_...
            </div>
          </div>
        </div>

        {/* Local & Terminal Testing */}
        <div className="space-y-3 pt-2">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Code className="w-3.5 h-3.5 text-slate-600" />
            <span>Local Development Forwarding via Stripe CLI</span>
          </h4>
          <div className="p-3.5 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs space-y-2 overflow-x-auto">
            <div className="text-slate-400"># 1. Login to Stripe CLI</div>
            <div>stripe login</div>
            <div className="text-slate-400 pt-1"># 2. Forward webhooks to local port 3000</div>
            <div>stripe listen --forward-to localhost:3000/api/stripe/webhook</div>
            <div className="text-slate-400 pt-1"># 3. Trigger test checkout session</div>
            <div>stripe trigger checkout.session.completed</div>
          </div>
        </div>

        {/* Generic Inbound Webhook Payload Example */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5 text-slate-600" />
            <span>Generic / Custom Webhook Ingestion (cURL Example)</span>
          </h4>
          <div className="p-3.5 rounded-xl bg-slate-950 text-slate-200 font-mono text-xs space-y-2 overflow-x-auto">
            <div className="text-slate-400"># Ingest arbitrary partner settlement webhook via HTTP POST</div>
            <div>
              {`curl -X POST ${incomingWebhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"event": "disbursement.settled", "amount": 5000.00, "reference": "REF-89421"}'`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
