import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Building2,
  CheckSquare,
  FileCheck2,
  FolderOpen,
  GitBranch,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Scale,
  Search,
  Settings,
  Shield,
  Target,
  Users,
  X,
} from 'lucide-react';
import { apiFetch, setAuthToken, setUnauthorizedHandler } from './api';
import { AdminPortal } from './components/AdminPortal';
import { AuthScreen } from './components/AuthScreen';
import { BrandMark } from './components/BrandMark';
import { DashboardView } from './components/DashboardView';
import { KnowledgeGraphView } from './components/KnowledgeGraphView';
import { OnboardingWizard } from './components/OnboardingWizard';
import { RegulatoryCenter } from './components/RegulatoryCenter';
import { ApplicabilityView } from './components/ApplicabilityView';
import {
  EvidenceVerificationView,
  RemediationCenterView,
} from './components/RemediationEvidenceViews';
import {
  CompanyProfileView,
  ComplianceCenterView,
  ControlsView,
  DocumentsView,
  SettingsView,
  UsersAccessView,
  AuditLogView,
} from './components/WorkspaceViews';
import type {
  DashboardData,
  NavView,
  NotificationItem,
  Organization,
  RegulationItem,
  UserInfo,
} from './types';

const NAV_ITEMS: Array<{ id: NavView; label: string; icon: React.ComponentType<any> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'compliance-center', label: 'Compliance Center', icon: Activity },
  { id: 'regulations', label: 'Regulatory Changes', icon: Scale },
  { id: 'applicability', label: 'Applicability', icon: Target },
  { id: 'company-profile', label: 'Company Profile', icon: Building2 },
  { id: 'documents', label: 'Documents', icon: FolderOpen },
  { id: 'controls', label: 'Controls', icon: Shield },
  { id: 'remediation', label: 'Remediation', icon: CheckSquare },
  { id: 'evidence', label: 'Evidence & Verification', icon: FileCheck2 },
  { id: 'knowledge-graph', label: 'Knowledge Graph', icon: GitBranch },
  { id: 'audit-log', label: 'Audit Log', icon: History },
  { id: 'users', label: 'Users & Access', icon: Users },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState<boolean>(
    () => typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')
  );
  const [user, setUser] = useState<UserInfo | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [activeView, setActiveView] = useState<NavView>('dashboard');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [regulations, setRegulations] = useState<RegulationItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loadingDash, setLoadingDash] = useState(false);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [authenticatedAdminUser, setAuthenticatedAdminUser] = useState<string | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setOrganization(null);
      setDashboard(null);
      setRegulations([]);
      setNotifications([]);
      setAuthenticatedAdminUser(null);
      setSessionNotice('Your session expired or was revoked. Please sign in again.');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setLoadingDash(true);
    try {
      const [dashRes, regsRes, notifRes, orgRes] = await Promise.all([
        apiFetch<DashboardData>('/api/dashboard'),
        apiFetch<RegulationItem[]>('/api/regulations'),
        apiFetch<NotificationItem[]>('/api/notifications'),
        apiFetch<Organization>('/api/organizations/me'),
      ]);
      setDashboard(dashRes);
      setRegulations(regsRes);
      setNotifications(notifRes);
      setOrganization(orgRes);
    } finally {
      setLoadingDash(false);
    }
  }, []);

  useEffect(() => {
    if (user && organization && organization.onboarding_completed === 1) {
      loadWorkspaceData();
    }
  }, [user, organization?.onboarding_completed, loadWorkspaceData]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q || !user) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(() => {
      apiFetch<any>(`/api/search?q=${encodeURIComponent(q)}`)
        .then(setSearchResults)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery, user]);

  const handleAuthenticated = (payload: {
    token: string;
    user: UserInfo;
    organization: Organization;
  }) => {
    setSessionNotice(null);
    setAuthToken(payload.token);
    setUser(payload.user);
    setOrganization(payload.organization);
    setActiveView('dashboard');
  };

  const handleSignOut = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setUser(null);
    setOrganization(null);
    setDashboard(null);
    setRegulations([]);
    setNotifications([]);
    setSessionNotice(null);
  };

  const handleNavigate = (view: NavView, itemId?: string) => {
    setActiveView(view);
    if (itemId !== undefined) {
      setSelectedItemId(itemId);
    } else if (
      view !== 'regulations' &&
      view !== 'applicability' &&
      view !== 'remediation' &&
      view !== 'evidence'
    ) {
      setSelectedItemId(null);
    }
    setMobileMenuOpen(false);
    setSearchResults(null);
    setSearchQuery('');
    setNotifOpen(false);
  };

  const handleMarkAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  if (isAdminRoute) {
    return (
      <AdminPortal
        initialAdminUser={authenticatedAdminUser}
        sessionNotice={sessionNotice}
        onExitToApp={() => {
          setIsAdminRoute(false);
          setAuthenticatedAdminUser(null);
          setSessionNotice(null);
          if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    );
  }

  if (!user || !organization) {
    return (
      <AuthScreen
        sessionNotice={sessionNotice}
        onAuthenticated={handleAuthenticated}
        onAdminAuthenticated={({ token, username }) => {
          setSessionNotice(null);
          setAuthToken(token);
          setAuthenticatedAdminUser(username);
          setIsAdminRoute(true);
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/admin');
          }
        }}
        onOpenAdminPortal={() => {
          setAuthenticatedAdminUser(null);
          setSessionNotice(null);
          setIsAdminRoute(true);
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/admin/login');
          }
        }}
      />
    );
  }

  if (organization.onboarding_completed === 0) {
    return (
      <OnboardingWizard
        organization={organization}
        onCompleted={async () => {
          const updatedOrg = await apiFetch<Organization>('/api/organizations/me');
          setOrganization(updatedOrg);
        }}
      />
    );
  }

  const unreadCount = notifications.filter((n) => n.is_read === 0).length;
  const activeNavLabel = NAV_ITEMS.find((i) => i.id === activeView)?.label || 'Dashboard';

  return (
    <div className="min-h-screen bg-[#F4F7FB] flex">
      {/* Left Deep Navy Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 bg-[#0F1D3D] text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-4">
          <div className="flex items-center justify-between px-2 py-1 mb-5">
            <BrandMark dark size="md" />
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>

          <nav className="space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavigate(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-[#2563EB] text-white'
                      : 'text-slate-300 hover:bg-[#182952] hover:text-white'
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-2.5">
          <div className="px-2">
            <div className="text-xs font-semibold text-white truncate">{organization.name}</div>
            <div className="text-[11px] text-slate-400 truncate">
              {user.fullName} · {user.role.replace('_', ' ')}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-[#182952] hover:text-white cursor-pointer"
          >
            <LogOut size={14} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content Shell */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-15 bg-white border-b border-[#E2E8F0] px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg border border-[#E2E8F0] text-[#475569] cursor-pointer"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <div className="text-xs sm:text-sm font-semibold text-[#0F172A] truncate">
              <span className="text-[#64748B] font-normal">{organization.name}</span>
              <span className="mx-2 text-[#CBD5E1]">/</span>
              <span>{activeNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* Global Search */}
            <div className="relative hidden md:block w-72">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]"
              />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search regulations, controls, evidence..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
              />

              {searchResults && (
                <div className="absolute right-0 mt-1.5 w-96 bg-white border border-[#E2E8F0] rounded-xl shadow-lg p-3 z-50 space-y-2 text-xs">
                  {searchResults.regulations?.length > 0 && (
                    <div>
                      <div className="font-semibold text-[#64748B] px-2 mb-1">Regulations</div>
                      {searchResults.regulations.map((r: any) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => handleNavigate('regulations', r.id)}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <span className="font-mono font-bold text-[#2563EB]">{r.code}</span>{' '}
                          {r.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.remediation?.length > 0 && (
                    <div>
                      <div className="font-semibold text-[#64748B] px-2 mb-1">Remediation</div>
                      {searchResults.remediation.map((a: any) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => handleNavigate('remediation', a.id)}
                          className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F8FAFC] cursor-pointer"
                        >
                          <span className="font-mono font-bold text-[#0F172A]">{a.code}</span>{' '}
                          {a.title}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.controls?.length === 0 &&
                    searchResults.regulations?.length === 0 &&
                    searchResults.remediation?.length === 0 && (
                      <div className="text-[#64748B] px-2 py-1">No matching items found.</div>
                    )}
                </div>
              )}
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen(!notifOpen)}
                className="relative p-2 rounded-lg border border-[#E2E8F0] hover:bg-[#F8FAFC] text-[#475569] cursor-pointer"
                aria-label="Notifications"
              >
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#2563EB] text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-[#E2E8F0] rounded-xl shadow-lg z-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-[#E2E8F0] flex items-center justify-between text-xs">
                    <span className="font-bold text-[#0F172A]">Notifications</span>
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-[#2563EB] font-semibold hover:underline cursor-pointer"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => handleNavigate(n.link_view, n.link_id || undefined)}
                        className={`w-full text-left px-4 py-3 text-xs hover:bg-[#F8FAFC] cursor-pointer ${
                          n.is_read === 0 ? 'bg-[#EFF6FF]/50' : ''
                        }`}
                      >
                        <div className="font-semibold text-[#0F172A]">{n.title}</div>
                        <div className="text-[#64748B] mt-0.5">{n.message}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-5 sm:p-7 max-w-[1380px] w-full mx-auto">
          {activeView === 'dashboard' && (
            <DashboardView
              data={dashboard}
              regulations={regulations}
              loading={loadingDash}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'compliance-center' && (
            <ComplianceCenterView onNavigate={handleNavigate} />
          )}

          {activeView === 'regulations' && (
            <RegulatoryCenter
              regulations={regulations}
              selectedRegulationId={selectedItemId}
              onSelectRegulation={(id) => setSelectedItemId(id)}
              onNavigate={handleNavigate}
              onDataChanged={loadWorkspaceData}
            />
          )}

          {activeView === 'applicability' && (
            <ApplicabilityView
              selectedObligationId={selectedItemId}
              onSelectObligation={(id) => setSelectedItemId(id)}
              onNavigate={handleNavigate}
              onDataChanged={loadWorkspaceData}
            />
          )}

          {activeView === 'company-profile' && (
            <CompanyProfileView onDataChanged={loadWorkspaceData} />
          )}

          {activeView === 'documents' && (
            <DocumentsView onDataChanged={loadWorkspaceData} />
          )}

          {activeView === 'controls' && <ControlsView />}

          {activeView === 'remediation' && (
            <RemediationCenterView
              initialActionId={selectedItemId}
              onNavigate={handleNavigate}
              onDataChanged={loadWorkspaceData}
            />
          )}

          {activeView === 'evidence' && (
            <EvidenceVerificationView
              initialRemediationId={selectedItemId}
              onNavigate={handleNavigate}
              onDataChanged={loadWorkspaceData}
            />
          )}

          {activeView === 'knowledge-graph' && (
            <KnowledgeGraphView
              regulations={regulations}
              initialRegulationId={selectedItemId}
              onNavigate={handleNavigate}
            />
          )}

          {activeView === 'audit-log' && <AuditLogView />}

          {activeView === 'users' && <UsersAccessView currentRole={user.role} />}

          {activeView === 'settings' && <SettingsView organization={organization} />}
        </main>
      </div>
    </div>
  );
}
