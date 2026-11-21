import React, { useState } from 'react';
import { ArrowRight, Building2, Lock, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../api';
import type { Organization, UserInfo } from '../types';
import { BrandMark } from './BrandMark';

interface AuthScreenProps {
  sessionNotice?: string | null;
  onAuthenticated: (payload: { token: string; user: UserInfo; organization: Organization }) => void;
  onAdminAuthenticated: (payload: { token: string; username: string }) => void;
  onOpenAdminPortal: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  sessionNotice = null,
  onAuthenticated,
  onAdminAuthenticated,
  onOpenAdminPortal,
}) => {
  const [mode, setMode] = useState<'login' | 'signup' | 'admin'>('login');
  const [email, setEmail] = useState('demo@complianceos.local');
  const [adminUsername, setAdminUsername] = useState('test_123');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('Bangladesh');
  const [industry, setIndustry] = useState('Financial Technology / Digital Payments');
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (nextMode: 'login' | 'signup' | 'admin') => {
    setMode(nextMode);
    setError(null);
    setPassword('');
    if (nextMode === 'login') {
      setEmail('demo@complianceos.local');
    } else if (nextMode === 'signup') {
      setEmail('');
    } else if (nextMode === 'admin') {
      setAdminUsername('test_123');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        const res = await apiFetch<{ token: string; user: UserInfo; organization: Organization }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          }
        );
        onAuthenticated(res);
      } else if (mode === 'signup') {
        const res = await apiFetch<{ token: string; user: UserInfo; organization: Organization }>(
          '/api/auth/signup',
          {
            method: 'POST',
            body: JSON.stringify({
              fullName,
              companyName,
              email,
              password,
              country,
              industry,
            }),
          }
        );
        onAuthenticated(res);
      } else {
        const res = await apiFetch<{ token: string; admin: { username: string } }>(
          '/api/auth/admin/login',
          {
            method: 'POST',
            body: JSON.stringify({ username: adminUsername, password }),
          }
        );
        onAdminAuthenticated({ token: res.token, username: res.admin.username });
      }
    } catch (err: any) {
      setError(err?.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoAccess = async () => {
    setError(null);
    setDemoLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: UserInfo; organization: Organization }>(
        '/api/auth/demo',
        { method: 'POST' }
      );
      onAuthenticated(res);
    } catch (err: any) {
      setError(err?.message || 'Unable to launch demo workspace.');
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F7FB] flex flex-col justify-between p-6 md:p-10">
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <BrandMark size="md" />
        <button
          type="button"
          onClick={onOpenAdminPortal}
          className="text-sm font-medium text-[#475569] hover:text-[#0F172A] flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Lock size={14} />
          <span>Platform Admin Portal</span>
        </button>
      </div>

      <div className="my-auto py-8 flex items-center justify-center">
        <div className="w-full max-w-[440px] bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-8">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-[#2563EB] flex items-center justify-center text-white mb-4 shadow-sm">
              <ShieldCheck size={24} />
            </div>
            <h1 className="font-display text-2xl font-bold text-[#0F172A] tracking-tight">
              ComplianceOS
            </h1>
            <p className="text-sm text-[#64748B] mt-1.5">
              Continuous regulatory intelligence, impact mapping, and verifiable audit trails.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-[#F1F5F9] rounded-lg mb-6">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'login'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              User Login
            </button>
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'signup'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Create Org
            </button>
            <button
              type="button"
              onClick={() => switchMode('admin')}
              className={`py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                mode === 'admin'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Admin Login
            </button>
          </div>

          {(error || sessionNotice) && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700"
            >
              {error || sessionNotice}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">
                    Full name
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Tariq Rahman"
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">
                    Company name
                  </label>
                  <input
                    type="text"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Acme FinTech Ltd."
                    className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#334155] mb-1">
                      Country
                    </label>
                    <input
                      type="text"
                      required
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#334155] mb-1">
                      Industry
                    </label>
                    <input
                      type="text"
                      required
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                    />
                  </div>
                </div>
              </>
            )}

            {mode === 'admin' ? (
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Admin username
                </label>
                <input
                  type="text"
                  required
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="test_123"
                  className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Work email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="demo@complianceos.local"
                  className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#334155] mb-1">
                Password
              </label>
              <input
                type="password"
                required
                minLength={mode === 'signup' ? 8 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  mode === 'signup'
                    ? 'Minimum 8 characters'
                    : 'Enter any password (demo mode)'
                }
                className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full rounded-lg text-white font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                mode === 'admin'
                  ? 'bg-[#0F1D3D] hover:bg-[#172B59]'
                  : 'bg-[#2563EB] hover:bg-[#1D4ED8]'
              } disabled:opacity-60`}
            >
              <span>
                {loading
                  ? 'Authenticating...'
                  : mode === 'login'
                  ? 'Sign In'
                  : mode === 'signup'
                  ? 'Create Organization Workspace'
                  : 'Sign In to Platform Admin'}
              </span>
              <ArrowRight size={15} />
            </button>
          </form>

          {mode === 'login' && (
            <div className="mt-6 pt-5 border-t border-[#E2E8F0]">
              <button
                type="button"
                onClick={handleDemoAccess}
                disabled={demoLoading}
                className="w-full rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-[#0F172A] font-medium text-xs py-2.5 px-4 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Building2 size={14} className="text-[#2563EB]" />
                <span>
                  {demoLoading
                    ? 'Opening Demo Workspace...'
                    : 'One-Click Demo — BanglaPay Technologies Ltd.'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B]">
        <span>ComplianceOS · Multi-Tenant Regulatory Compliance Platform</span>
        <span>Decision support tool — human verification required for compliance sign-off</span>
      </div>
    </div>
  );
};
