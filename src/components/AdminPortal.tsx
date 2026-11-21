import React, { useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  CheckCircle2,
  FileText,
  Lock,
  LogOut,
  Shield,
  Users,
} from 'lucide-react';
import { apiFetch, setAuthToken } from '../api';
import { BrandMark } from './BrandMark';

interface AdminPortalProps {
  initialAdminUser?: string | null;
  sessionNotice?: string | null;
  onExitToApp: () => void;
}

interface AdminOverview {
  metrics: {
    totalOrganizations: number;
    totalUsers: number;
    activeOrganizations: number;
    documentsProcessed: number;
    regulatoryAnalyses: number;
    openRemediationActions: number;
    verifiedControls: number;
    totalEvidence: number;
  };
  organizations: Array<{
    id: string;
    name: string;
    country: string;
    industry: string;
    size: string;
    onboarding_completed: number;
    is_demo: number;
    created_at: string;
    user_count: number;
    document_count: number;
    regulation_count: number;
    open_action_count: number;
    verified_control_count: number;
  }>;
  processingBreakdown: Array<{ status: string; count: number }>;
  recentSystemEvents: Array<{
    id: string;
    timestamp: string;
    organization_name: string;
    action: string;
    object_type: string;
    new_state: string;
  }>;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  initialAdminUser = null,
  sessionNotice = null,
  onExitToApp,
}) => {
  const [username, setUsername] = useState('test_123');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<string | null>(initialAdminUser);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'organizations' | 'activity'>('overview');

  const loadOverview = async () => {
    const data = await apiFetch<AdminOverview>('/api/admin/overview');
    setOverview(data);
  };

  useEffect(() => {
    setAdminUser(initialAdminUser);
    if (initialAdminUser) {
      loadOverview().catch(() => {
        setAuthToken(null);
        setAdminUser(null);
        setOverview(null);
      });
    } else {
      setOverview(null);
    }
  }, [initialAdminUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; admin: { username: string } }>(
        '/api/auth/admin/login',
        {
          method: 'POST',
          body: JSON.stringify({ username, password }),
        }
      );
      setAuthToken(res.token);
      setAdminUser(res.admin.username);
      await loadOverview();
    } catch (err: any) {
      setError(err?.message || 'Admin authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setAdminUser(null);
    setOverview(null);
    setPassword('');
    onExitToApp();
  };

  if (!adminUser || !overview) {
    return (
      <div className="min-h-screen bg-[#F4F7FB] flex flex-col justify-between p-6 md:p-10">
        <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
          <BrandMark size="md" />
          <button
            type="button"
            onClick={onExitToApp}
            className="text-sm font-medium text-[#475569] hover:text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Back to Workspace Sign In</span>
          </button>
        </div>

        <div className="my-auto py-8 flex items-center justify-center">
          <div className="w-full max-w-[420px] bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-8">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-11 h-11 rounded-xl bg-[#0F1D3D] flex items-center justify-center text-white mb-3">
                <Lock size={20} />
              </div>
              <h1 className="font-display text-xl font-bold text-[#0F172A]">
                Platform Administrator Login
              </h1>
              <p className="text-xs text-[#64748B] mt-1.5 leading-relaxed">
                Access aggregate platform telemetry. Private customer documents remain isolated.
              </p>
            </div>

            {(error || sessionNotice) && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                {error || sessionNotice}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Admin username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter any password (admin demo)"
                  className="w-full rounded-lg border border-[#CBD5E1] px-3.5 py-2.5 text-sm text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0F1D3D] hover:bg-[#172B59] text-white font-semibold text-sm py-2.5 px-4 transition-colors cursor-pointer"
              >
                {loading ? 'Verifying...' : 'Sign In to Platform Admin'}
              </button>
            </form>
          </div>
        </div>

        <div className="text-center text-xs text-[#64748B]">
          Route: /admin/login · Tenant document contents are excluded from platform admin views.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F7FB] flex">
      <aside className="w-60 bg-[#0F1D3D] text-white flex flex-col justify-between p-5 shrink-0">
        <div>
          <BrandMark dark size="md" />
          <div className="mt-6 text-[11px] font-medium text-slate-400 px-2 mb-2">
            Platform Administration
          </div>
          <nav className="space-y-1">
            {[
              { id: 'overview', label: 'Platform Metrics', icon: Activity },
              { id: 'organizations', label: 'Organizations', icon: Building2 },
              { id: 'activity', label: 'System Activity', icon: Shield },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id as any)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active ? 'bg-[#2563EB] text-white' : 'text-slate-300 hover:bg-[#182952]'
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="pt-4 border-t border-white/10 space-y-2">
          <div className="px-2 text-xs text-slate-300">
            Signed in as <span className="font-semibold text-white">{adminUser}</span>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-[#182952] cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-[#0F172A]">
              Platform Operations Overview
            </h1>
            <p className="text-sm text-[#64748B] mt-1">
              Aggregate multi-tenant metrics across registered ComplianceOS organizations. Customer document contents remain strictly private.
            </p>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            className="px-4 py-2 text-xs font-semibold bg-white border border-[#CBD5E1] rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            Refresh Metrics
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Organizations', value: overview.metrics.totalOrganizations, sub: `${overview.metrics.activeOrganizations} onboarded`, icon: Building2 },
            { label: 'Total Users', value: overview.metrics.totalUsers, sub: 'Across all workspaces', icon: Users },
            { label: 'Documents Processed', value: overview.metrics.documentsProcessed, sub: `${overview.metrics.regulatoryAnalyses} analyses run`, icon: FileText },
            { label: 'Verified Controls', value: overview.metrics.verifiedControls, sub: `${overview.metrics.openRemediationActions} open actions`, icon: CheckCircle2 },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="bg-white border border-[#E2E8F0] rounded-xl p-5">
                <div className="flex items-center justify-between text-xs font-medium text-[#64748B] mb-2">
                  <span>{stat.label}</span>
                  <Icon size={15} className="text-[#2563EB]" />
                </div>
                <div className="font-display text-2xl font-bold text-[#0F172A] tabular-nums">
                  {stat.value}
                </div>
                <div className="text-xs text-[#64748B] mt-1">{stat.sub}</div>
              </div>
            );
          })}
        </div>

        {(activeTab === 'overview' || activeTab === 'organizations') && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden mb-6">
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Registered Organizations (Aggregate Counts Only)
              </h2>
              <span className="text-xs text-[#64748B]">
                Private documents & evidence files hidden
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
                    <th className="py-3 px-5">Organization</th>
                    <th className="py-3 px-4">Jurisdiction / Industry</th>
                    <th className="py-3 px-4 text-right">Users</th>
                    <th className="py-3 px-4 text-right">Docs</th>
                    <th className="py-3 px-4 text-right">Open Actions</th>
                    <th className="py-3 px-4 text-right">Verified Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-sm">
                  {overview.organizations.map((org) => (
                    <tr key={org.id} className="hover:bg-[#F8FAFC]">
                      <td className="py-3 px-5 font-medium text-[#0F172A]">
                        <div>{org.name}</div>
                        <div className="text-xs text-[#64748B] font-normal">
                          {org.size} · {org.onboarding_completed ? 'Active' : 'Onboarding'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[#475569]">
                        {org.country} · {org.industry}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums">{org.user_count}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{org.document_count}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-amber-700 font-medium">
                        {org.open_action_count}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-emerald-700 font-medium">
                        {org.verified_control_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(activeTab === 'overview' || activeTab === 'activity') && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0]">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Recent Platform Activity Stream
              </h2>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {overview.recentSystemEvents.map((ev) => (
                <div key={ev.id} className="px-5 py-3 flex items-center justify-between text-xs gap-4">
                  <div>
                    <span className="font-semibold text-[#0F172A]">{ev.organization_name}</span>
                    <span className="text-[#64748B]"> · {ev.action} ({ev.object_type})</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[#475569]">{ev.new_state}</span>
                    <span className="font-mono text-[#64748B] tabular-nums">
                      {new Date(ev.timestamp).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
