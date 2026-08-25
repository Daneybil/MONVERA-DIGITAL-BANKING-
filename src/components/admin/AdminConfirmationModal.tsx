import React, { useState } from 'react';
import { ShieldAlert, AlertTriangle, Check, X } from 'lucide-react';

interface AdminConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: 'danger' | 'warning' | 'primary';
  requireReason?: boolean;
  targetEntityName?: string;
}

export const AdminConfirmationModal: React.FC<AdminConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm Action',
  confirmVariant = 'danger',
  requireReason = true,
  targetEntityName,
}) => {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (requireReason && !reason.trim()) {
      setError('Please provide a mandatory compliance justification or audit reason.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      await onConfirm(reason.trim());
      setReason('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Action failed to execute. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getVariantStyles = () => {
    switch (confirmVariant) {
      case 'danger':
        return {
          icon: <ShieldAlert className="w-6 h-6 text-rose-500" />,
          btn: 'bg-rose-600 hover:bg-rose-700 text-white shadow-sm shadow-rose-600/20',
          badge: 'bg-rose-50 border-rose-200 text-rose-700',
        };
      case 'warning':
        return {
          icon: <AlertTriangle className="w-6 h-6 text-amber-500" />,
          btn: 'bg-amber-600 hover:bg-amber-700 text-white shadow-sm shadow-amber-600/20',
          badge: 'bg-amber-50 border-amber-200 text-amber-700',
        };
      case 'primary':
      default:
        return {
          icon: <Check className="w-6 h-6 text-emerald-500" />,
          btn: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-600/20',
          badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
              {styles.icon}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900 leading-tight">{title}</h3>
              <p className="text-xs text-slate-500 font-medium">Fintech Administrative Authorization Required</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {targetEntityName && (
          <div className="mb-4 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
            <span className="text-slate-500">Target Account / Subject:</span>
            <span className="font-mono font-medium text-slate-800">{targetEntityName}</span>
          </div>
        )}

        <div className="text-sm text-slate-600 leading-relaxed mb-4">
          {description}
        </div>

        {requireReason && (
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Audit Justification / Compliance Reason <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              rows={3}
              placeholder="e.g. Identity verification confirmed via FinCEN database / Administrative compliance check..."
              className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-800 text-slate-900 placeholder:text-slate-400 resize-none transition-all"
            />
            {error && (
              <p className="text-xs text-rose-600 font-medium mt-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`px-5 py-2 text-sm font-medium rounded-xl transition-colors flex items-center gap-2 ${styles.btn} ${
              isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Executing...
              </>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
