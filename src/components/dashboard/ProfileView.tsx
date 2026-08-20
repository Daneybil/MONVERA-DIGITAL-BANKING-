import React from 'react';
import { useAuth } from '../../context/AuthContext';
import {
  User,
  ShieldCheck,
  Mail,
  Phone,
  Calendar,
  Globe,
  Award,
  CheckCircle2,
  Building2,
} from 'lucide-react';

export const ProfileView: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) return null;

  return (
    <div id="profile-management-view" className="space-y-8 animate-in fade-in duration-150">
      
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Customer Profile & KYC</h2>
        <p className="text-xs sm:text-sm text-slate-500">
          Your verified identity records, permanent routing identifiers, and banking tier status.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Profile Card */}
        <div className="p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-2xs space-y-6 text-center lg:text-left">
          <div className="flex flex-col lg:flex-row items-center gap-4">
            <img
              src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}
              alt={currentUser.firstName}
              className="w-20 h-20 rounded-full object-cover border-2 border-emerald-500 shadow-md"
            />
            <div>
              <div className="flex items-center justify-center lg:justify-start gap-1.5 font-bold text-lg text-slate-900">
                <span>{currentUser.firstName} {currentUser.lastName}</span>
                <CheckCircle2 className="w-5 h-5 text-emerald-600 fill-emerald-100" />
              </div>
              <div className="text-xs text-slate-500 font-mono">
                Member since {new Date(currentUser.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}
              </div>
              <span className="inline-block mt-1 text-[10px] uppercase font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-mono">
                {currentUser.membershipTier} Tier
              </span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs font-mono">
            <div className="flex justify-between text-slate-500 font-sans">
              <span>Account Status:</span>
              <span className="font-bold text-emerald-700 font-sans">{currentUser.accountStatus}</span>
            </div>
            <div className="flex justify-between text-slate-500 font-sans">
              <span>KYC Level:</span>
              <span className="font-bold text-slate-900 font-sans">Tier 3 (Institutional)</span>
            </div>
            <div className="flex justify-between text-slate-500 font-sans">
              <span>Role:</span>
              <span className="font-bold text-slate-900 font-sans">{currentUser.role}</span>
            </div>
          </div>
        </div>

        {/* Identity Details */}
        <div className="lg:col-span-2 p-6 sm:p-8 rounded-3xl bg-white border border-slate-200/90 shadow-2xs space-y-6">
          <h3 className="font-bold text-base text-slate-900">Identity & Verification Records</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                <span>Email Address</span>
              </span>
              <span className="font-bold text-slate-900 block">{currentUser.email}</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5" />
                <span>Verified Phone</span>
              </span>
              <span className="font-bold text-slate-900 block">{currentUser.phoneNumber}</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>Date of Birth</span>
              </span>
              <span className="font-bold text-slate-900 block">{currentUser.dateOfBirth}</span>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-1">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>Jurisdiction</span>
              </span>
              <span className="font-bold text-slate-900 block">{currentUser.country}</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-950 space-y-1">
              <div className="font-bold">Permanent Regulatory Clearance</div>
              <p className="text-emerald-800 leading-relaxed">
                Your account is fully verified under FinCEN / Bank Secrecy Act guidelines. There are no restrictions on inbound wire transfers or term investment volumes.
              </p>
            </div>
          </div>
        </div>

      </div>

    </div>
  );
};
