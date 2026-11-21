import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  Plus,
  Shield,
  Terminal,
  Upload,
} from 'lucide-react';
import { apiFetch, setAuthToken } from '../api';
import type {
  AuditEvent,
  CompanyProfileVersion,
  ControlItem,
  DocumentItem,
  NavView,
  Organization,
  ProfileCompleteness,
  ProfileTriState,
  StructuredCompanyProfile,
} from '../types';

// --- 1. Compliance Center (Workflow Hub + MCP Console + Guardrail Evals) ---
export const ComplianceCenterView: React.FC<{
  onNavigate: (view: NavView, itemId?: string) => void;
}> = ({ onNavigate }) => {
  const [evals, setEvals] = useState<{
    passedCount: number;
    totalCount: number;
    checks: Array<{ id: string; name: string; category: string; passed: boolean; detail: string }>;
  } | null>(null);
  const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([]);
  const [selectedTool, setSelectedTool] = useState('search_regulations');
  const [mcpArgs, setMcpArgs] = useState('{"query": "PSD"}');
  const [mcpOutput, setMcpOutput] = useState<string>('');
  const [runningMcp, setRunningMcp] = useState(false);

  useEffect(() => {
    apiFetch<any>('/api/evals').then(setEvals).catch(() => {});
    apiFetch<{ tools: any[] }>('/api/mcp/tools')
      .then((res) => setMcpTools(res.tools || []))
      .catch(() => {});
  }, []);

  const handleCallMcp = async () => {
    setRunningMcp(true);
    try {
      const parsedArgs = mcpArgs.trim() ? JSON.parse(mcpArgs) : {};
      const res = await apiFetch<any>('/api/mcp/call', {
        method: 'POST',
        body: JSON.stringify({ toolName: selectedTool, arguments: parsedArgs }),
      });
      setMcpOutput(JSON.stringify(res.result, null, 2));
    } catch (err: any) {
      setMcpOutput(`Error: ${err?.message || 'Invalid JSON or MCP call failed'}`);
    } finally {
      setRunningMcp(false);
    }
  };

  const pipelineSteps: Array<{ title: string; desc: string; view: NavView }> = [
    { title: '01. Monitor & Diff', desc: 'Inspect circular updates & clause changes', view: 'regulations' },
    { title: '02. Applicability', desc: 'Evaluate obligations against your profile', view: 'applicability' },
    { title: '03. Impact Graph', desc: 'Trace obligations, controls & systems', view: 'knowledge-graph' },
    { title: '04. Remediate & Prove', desc: 'Approve policies, upload & verify proof', view: 'evidence' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#0F172A]">Compliance Center</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          End-to-end compliance workflow orchestration, MCP tool server, and deterministic guardrail evaluations.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {pipelineSteps.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onNavigate(s.view)}
            className="text-left bg-white border border-[#E2E8F0] hover:border-[#2563EB] rounded-xl p-5 transition-colors cursor-pointer"
          >
            <div className="font-display text-sm font-bold text-[#0F172A]">{s.title}</div>
            <div className="text-xs text-[#64748B] mt-1">{s.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Guardrails & Deterministic Evals */}
        <div className="xl:col-span-6 bg-white border border-[#E2E8F0] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-[#2563EB]" />
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Compliance Guardrails & Evaluation Suite
              </h2>
            </div>
            {evals && (
              <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                {evals.passedCount}/{evals.totalCount} Passing
              </span>
            )}
          </div>
          <div className="space-y-2.5">
            {evals?.checks.map((chk) => (
              <div
                key={chk.id}
                className="border border-[#E2E8F0] rounded-lg p-3.5 flex items-start justify-between gap-3"
              >
                <div>
                  <div className="text-xs font-semibold text-[#0F172A]">
                    {chk.name}{' '}
                    <span className="text-[#64748B] font-normal">· {chk.category}</span>
                  </div>
                  <div className="text-xs text-[#475569] mt-0.5">{chk.detail}</div>
                </div>
                <CheckCircle2
                  size={16}
                  className={chk.passed ? 'text-emerald-600 shrink-0' : 'text-red-600 shrink-0'}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Live Scoped ComplianceOS MCP Tool Console */}
        <div className="xl:col-span-6 bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal size={16} className="text-[#2563EB]" />
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                ComplianceOS MCP Endpoint Explorer
              </h2>
            </div>
            <span className="text-xs font-mono text-[#64748B]">/api/mcp/call</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#334155] mb-1">MCP Tool</label>
              <select
                value={selectedTool}
                onChange={(e) => {
                  const t = e.target.value;
                  setSelectedTool(t);
                  const templates: Record<string, string> = {
                    search_regulations: '{"query": "PSD"}',
                    get_regulation: '{"regulationId": "reg_bb_retention"}',
                    get_regulation_version: '{"regulationId": "rdoc_bb_psd09"}',
                    compare_regulation_versions: '{"regulationId": "rdoc_bb_psd09"}',
                    search_obligations: '{"query": "retention"}',
                    get_regulatory_changes: '{"limit": 5}',
                    summarize_regulatory_change: '{"changeId": "rchg_bb_psd09_v2"}',
                    query_compliance_graph: '{"regulationId": "reg_bb_retention"}',
                    get_company_profile: '{}',
                    update_company_profile: '{"structuredProfile": {"scale": {"annual_revenue": 650000000}}, "recalculate": true}',
                    get_applicability_assessment: '{"obligationId": "robl_bb_ret_5yr"}',
                    analyze_applicability: '{"obligationId": "robl_bb_ret_5yr", "useAi": false}',
                    get_applicable_obligations: '{"decision": "APPLIES"}',
                    get_missing_information: '{}',
                    search_evidence: '{"query": "retention"}',
                    create_remediation_action: '{"regulationId": "reg_bb_retention", "title": "Verify archive retention lock", "requiredChange": "Confirm 5-year Object Lock"}',
                  };
                  setMcpArgs(templates[t] || '{}');
                }}
                className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-mono"
              >
                {mcpTools.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#334155] mb-1">
                Arguments (JSON)
              </label>
              <input
                value={mcpArgs}
                onChange={(e) => setMcpArgs(e.target.value)}
                className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-mono"
              />
            </div>
          </div>

          <button
            type="button"
            disabled={runningMcp}
            onClick={handleCallMcp}
            className="px-4 py-2 rounded-lg bg-[#0F1D3D] hover:bg-[#182952] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <Cpu size={13} />
            <span>{runningMcp ? 'Invoking Tool...' : 'Execute Scoped MCP Tool'}</span>
          </button>

          {mcpOutput && (
            <pre className="bg-[#0F172A] text-slate-100 rounded-lg p-3.5 text-[11px] font-mono max-h-56 overflow-auto">
              {mcpOutput}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};

// --- 2. Company Profile (Normalized, Versioned, 7-Section Progressive Disclosure) ---
type ProfileTabId =
  | 'company'
  | 'industry'
  | 'geography'
  | 'regulatory'
  | 'products'
  | 'technology'
  | 'risk';

const TRI_OPTIONS: ProfileTriState[] = ['UNKNOWN', 'NOT_PROVIDED', 'NOT_APPLICABLE'];

export const CompanyProfileView: React.FC<{ onDataChanged: () => void }> = ({ onDataChanged }) => {
  const [org, setOrg] = useState<Organization | null>(null);
  const [profile, setProfile] = useState<StructuredCompanyProfile | null>(null);
  const [versionNumber, setVersionNumber] = useState<number>(1);
  const [completeness, setCompleteness] = useState<ProfileCompleteness | null>(null);
  const [versions, setVersions] = useState<CompanyProfileVersion[]>([]);
  const [systems, setSystems] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<ProfileTabId>('company');
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadProfileData = async () => {
    const [profRes, verRes] = await Promise.all([
      apiFetch<any>('/api/company/profile'),
      apiFetch<CompanyProfileVersion[]>('/api/company/profile/versions'),
    ]);
    setOrg(profRes.organization);
    setProfile(profRes.structuredProfile);
    setVersionNumber(profRes.versionNumber || 1);
    setCompleteness(profRes.completeness || null);
    setSystems(profRes.systems || []);
    setVersions(verRes || []);
  };

  useEffect(() => {
    loadProfileData().catch(() => {});
  }, []);

  const handleSave = async (e: React.FormEvent, recalculate = true) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setSavedMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<any>('/api/company/profile', {
        method: 'PUT',
        body: JSON.stringify({
          structuredProfile: profile,
          changeSummary: changeSummary.trim() || undefined,
          recalculate,
        }),
      });
      setChangeSummary('');
      await loadProfileData();
      onDataChanged();
      setSavedMsg(
        `Saved Profile v${res.versionNumber} (${res.completeness?.pct ?? 0}% complete)` +
          (recalculate ? ` and recalculated ${res.recalculatedCount} obligation assessments.` : '.')
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to save company profile.');
    } finally {
      setSaving(false);
    }
  };

  if (!org || !profile) {
    return <div className="h-72 bg-white rounded-xl border border-[#E2E8F0] animate-pulse" />;
  }

  const tabs: Array<{ id: ProfileTabId; label: string }> = [
    { id: 'company', label: 'Company' },
    { id: 'industry', label: 'Industry & Activities' },
    { id: 'geography', label: 'Geography' },
    { id: 'regulatory', label: 'Regulatory Status' },
    { id: 'products', label: 'Products & Services' },
    { id: 'technology', label: 'Data & Technology' },
    { id: 'risk', label: 'Risk Context' },
  ];

  const renderNumberOrTriState = (
    label: string,
    value: number | ProfileTriState,
    onChange: (next: number | ProfileTriState) => void,
    placeholder: string
  ) => {
    const isTri = typeof value === 'string';
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium text-[#334155]">{label}</label>
          <select
            value={isTri ? value : 'NUMBER'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'NUMBER') onChange(0);
              else onChange(v as ProfileTriState);
            }}
            className="text-[11px] rounded border border-[#CBD5E1] px-1.5 py-0.5 bg-[#F8FAFC] text-[#475569]"
          >
            <option value="NUMBER">Numeric Value</option>
            {TRI_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        {isTri ? (
          <div className="w-full rounded-lg border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs font-mono text-[#64748B]">
            Marked as {value} (will trigger missing-info check if required by rule)
          </div>
        ) : (
          <input
            type="number"
            min={0}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value === '' ? 'NOT_PROVIDED' : Number(e.target.value))}
            className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm font-mono"
          />
        )}
      </div>
    );
  };

  const renderBoolOrTriState = (
    label: string,
    value: boolean | ProfileTriState,
    onChange: (next: boolean | ProfileTriState) => void
  ) => (
    <div>
      <label className="block text-xs font-medium text-[#334155] mb-1">{label}</label>
      <select
        value={typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : value}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'TRUE') onChange(true);
          else if (v === 'FALSE') onChange(false);
          else onChange(v as ProfileTriState);
        }}
        className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm bg-white"
      >
        <option value="TRUE">Yes (True)</option>
        <option value="FALSE">No (False)</option>
        <option value="UNKNOWN">UNKNOWN</option>
        <option value="NOT_PROVIDED">NOT_PROVIDED</option>
        <option value="NOT_APPLICABLE">NOT_APPLICABLE</option>
      </select>
    </div>
  );

  const listToStr = (arr: string[]) => arr.join(', ');
  const strToList = (s: string) => s.split(',').map((v) => v.trim()).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Company Profile · <span className="font-mono text-[#2563EB]">v{versionNumber}</span>
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Normalized, versioned company model grounding regulatory applicability decisions. Unknown fields remain explicit without guessing.
          </p>
        </div>
        {completeness && (
          <div className="bg-white border border-[#E2E8F0] rounded-xl px-4 py-3 min-w-[260px]">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#0F172A]">Profile Completeness</span>
              <span className="font-mono font-bold text-[#2563EB] tabular-nums">
                {completeness.pct}% ({completeness.populatedCount}/{completeness.totalCount})
              </span>
            </div>
            <div className="w-full h-2 bg-[#F1F5F9] rounded-full overflow-hidden mt-2">
              <div
                className="h-full bg-[#2563EB] transition-all"
                style={{ width: `${completeness.pct}%` }}
              />
            </div>
            <div className="text-[10px] text-[#64748B] mt-1.5">
              Completeness indicates profile coverage — not regulatory compliance status.
            </div>
          </div>
        )}
      </div>

      {savedMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {savedMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
          {errorMsg}
        </div>
      )}

      {completeness && completeness.missingRecommendedFields.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50/70 px-4 py-3 text-xs text-orange-900">
          <div className="font-semibold">
            Unpopulated / Unknown Fields ({completeness.missingRecommendedFields.length}):
          </div>
          <div className="text-[#7C2D12] mt-1">
            {completeness.missingRecommendedFields.map((f) => `${f.section}: ${f.label}`).join(' · ')}
          </div>
        </div>
      )}

      {/* 7-Tab Progressive Disclosure Editor */}
      <form
        onSubmit={(e) => handleSave(e, true)}
        className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden"
      >
        <div className="flex overflow-x-auto border-b border-[#E2E8F0] bg-[#F8FAFC] px-3 pt-2 gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg whitespace-nowrap cursor-pointer border-b-2 transition-colors ${
                activeTab === t.id
                  ? 'border-[#2563EB] text-[#2563EB] bg-white'
                  : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-5">
          {activeTab === 'company' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">Legal Name</label>
                  <input
                    value={profile.identity.legal_name}
                    onChange={(e) =>
                      setProfile({ ...profile, identity: { ...profile.identity, legal_name: e.target.value } })
                    }
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">Trading Name</label>
                  <input
                    value={profile.identity.trading_name}
                    onChange={(e) =>
                      setProfile({ ...profile, identity: { ...profile.identity, trading_name: e.target.value } })
                    }
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">Registration Number</label>
                  <input
                    value={profile.identity.registration_number}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        identity: { ...profile.identity, registration_number: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">Primary Country</label>
                  <input
                    value={profile.identity.country}
                    onChange={(e) =>
                      setProfile({ ...profile, identity: { ...profile.identity, country: e.target.value } })
                    }
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#334155] mb-1">Headquarters Location</label>
                  <input
                    value={profile.identity.headquarters_location}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        identity: { ...profile.identity, headquarters_location: e.target.value },
                      })
                    }
                    className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                  />
                </div>
                {renderNumberOrTriState(
                  'Employee Count',
                  profile.scale.employee_count,
                  (val) => setProfile({ ...profile, scale: { ...profile.scale, employee_count: val } }),
                  'e.g. 250'
                )}
                {renderNumberOrTriState(
                  `Annual Revenue (${profile.scale.annual_revenue_currency})`,
                  profile.scale.annual_revenue,
                  (val) => setProfile({ ...profile, scale: { ...profile.scale, annual_revenue: val } }),
                  'e.g. 750000000'
                )}
                {renderNumberOrTriState(
                  `Total Assets (${profile.scale.annual_revenue_currency})`,
                  profile.scale.assets,
                  (val) => setProfile({ ...profile, scale: { ...profile.scale, assets: val } }),
                  'e.g. 2500000000'
                )}
              </div>
            </div>
          )}

          {activeTab === 'industry' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">Primary Industry</label>
                <input
                  value={profile.business.industry}
                  onChange={(e) =>
                    setProfile({ ...profile, business: { ...profile.business, industry: e.target.value } })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">Company / Entity Type</label>
                <input
                  value={profile.business.company_type}
                  onChange={(e) =>
                    setProfile({ ...profile, business: { ...profile.business, company_type: e.target.value } })
                  }
                  placeholder="e.g. Payment Service Provider, Commercial Bank, SaaS"
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Business Activities (comma-separated)
                </label>
                <input
                  value={listToStr(profile.business.business_activities)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      business: { ...profile.business, business_activities: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-[#334155] mb-1">Business Model</label>
                <textarea
                  rows={2}
                  value={profile.business.business_model}
                  onChange={(e) =>
                    setProfile({ ...profile, business: { ...profile.business, business_model: e.target.value } })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'geography' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Countries of Operation (comma-separated)
                </label>
                <input
                  value={listToStr(profile.geography.countries_of_operation)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      geography: { ...profile.geography, countries_of_operation: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  States / Provinces / Regions (comma-separated)
                </label>
                <input
                  value={listToStr(profile.geography.states_provinces_regions)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      geography: { ...profile.geography, states_provinces_regions: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Customer Locations (comma-separated)
                </label>
                <input
                  value={listToStr(profile.geography.customer_locations)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      geography: { ...profile.geography, customer_locations: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Data Storage Locations (comma-separated)
                </label>
                <input
                  value={listToStr(profile.geography.data_storage_locations)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      geography: { ...profile.geography, data_storage_locations: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'regulatory' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Regulated Industries (comma-separated)
                </label>
                <input
                  value={listToStr(profile.regulatory.regulated_industries)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      regulatory: { ...profile.regulatory, regulated_industries: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Licenses &amp; Authorizations (comma-separated)
                </label>
                <input
                  value={listToStr(profile.regulatory.licenses)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      regulatory: { ...profile.regulatory, licenses: strToList(e.target.value) },
                    })
                  }
                  placeholder="e.g. Licensed Payment Service Provider (PSP), Tier-1 PSP"
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">Regulatory Status</label>
                <input
                  value={profile.regulatory.regulatory_status}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      regulatory: { ...profile.regulatory, regulatory_status: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Data Processing Activities (comma-separated)
                </label>
                <input
                  value={listToStr(profile.regulatory.data_processing_activities)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      regulatory: { ...profile.regulatory, data_processing_activities: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'products' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Products &amp; Services (comma-separated)
                </label>
                <input
                  value={listToStr(profile.business.products_services)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      business: { ...profile.business, products_services: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Regulated Products (comma-separated)
                </label>
                <input
                  value={listToStr(profile.regulatory.regulated_products)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      regulatory: { ...profile.regulatory, regulated_products: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Operating Regions (comma-separated)
                </label>
                <input
                  value={listToStr(profile.scale.operating_regions)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      scale: { ...profile.scale, operating_regions: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'technology' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Cloud Providers (comma-separated)
                </label>
                <input
                  value={listToStr(profile.technology.cloud_providers)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      technology: { ...profile.technology, cloud_providers: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Critical Systems (comma-separated)
                </label>
                <input
                  value={listToStr(profile.technology.critical_systems)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      technology: { ...profile.technology, critical_systems: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Data Types Processed (comma-separated)
                </label>
                <input
                  value={listToStr(profile.technology.data_types_processed)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      technology: { ...profile.technology, data_types_processed: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
              {renderBoolOrTriState('Payment Processing Enabled', profile.technology.payment_processing, (val) =>
                setProfile({ ...profile, technology: { ...profile.technology, payment_processing: val } })
              )}
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Third-Party Processors &amp; Security Vendors (comma-separated)
                </label>
                <input
                  value={listToStr(profile.technology.third_party_processors)}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      technology: { ...profile.technology, third_party_processors: strToList(e.target.value) },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}

          {activeTab === 'risk' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">Risk Profile</label>
                <select
                  value={profile.risk_context.risk_profile}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      risk_context: { ...profile.risk_context, risk_profile: e.target.value },
                    })
                  }
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-sm bg-white"
                >
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                  <option value="UNKNOWN">UNKNOWN</option>
                </select>
              </div>
              {renderBoolOrTriState(
                'Sensitive / Biometric Data Handled',
                profile.risk_context.sensitive_data_handled,
                (val) =>
                  setProfile({
                    ...profile,
                    risk_context: { ...profile.risk_context, sensitive_data_handled: val },
                  })
              )}
              {renderBoolOrTriState(
                'Critical National / Financial Infrastructure',
                profile.risk_context.critical_infrastructure,
                (val) =>
                  setProfile({
                    ...profile,
                    risk_context: { ...profile.risk_context, critical_infrastructure: val },
                  })
              )}
              {renderBoolOrTriState(
                'Publicly Traded Company',
                profile.risk_context.public_company_status,
                (val) =>
                  setProfile({
                    ...profile,
                    risk_context: { ...profile.risk_context, public_company_status: val },
                  })
              )}
              {renderBoolOrTriState(
                'Regulated Financial Institution Status',
                profile.risk_context.financial_institution_status,
                (val) =>
                  setProfile({
                    ...profile,
                    risk_context: { ...profile.risk_context, financial_institution_status: val },
                  })
              )}
            </div>
          )}

          <div className="pt-4 border-t border-[#E2E8F0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <input
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="Optional change summary (e.g. Updated annual revenue & Tier-1 PSP license)..."
              className="flex-1 rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
            >
              {saving ? 'Saving & Recalculating...' : 'Save Profile & Recalculate Applicability'}
            </button>
          </div>
        </div>
      </form>

      {/* Version History & Systems Inventory */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Profile Version History ({versions.length})
            </h2>
          </div>
          <div className="divide-y divide-[#E2E8F0] max-h-72 overflow-y-auto">
            {versions.map((v) => (
              <div key={v.id} className="px-6 py-3 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-[#0F172A]">
                    v{v.version_number} · {v.change_summary}
                  </div>
                  <div className="text-[#64748B] mt-0.5">
                    By {v.changed_by} · {v.completeness_pct}% profile completeness
                  </div>
                </div>
                <span className="font-mono text-[11px] text-[#64748B] shrink-0">
                  {new Date(v.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0]">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Registered Systems Inventory ({systems.length})
            </h2>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {systems.length === 0 ? (
              <div className="px-6 py-4 text-xs text-[#64748B]">
                No technical systems registered yet.
              </div>
            ) : (
              systems.map((sys) => (
                <div key={sys.id} className="px-6 py-3.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-[#0F172A]">{sys.name}</span>
                    <span className="text-[#64748B]">
                      {' '}
                      · {sys.category} · {sys.provider}
                    </span>
                  </div>
                  <div className="text-[#475569]">
                    {sys.data_classification} · {sys.owner_department}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- 3. Document Center ---
export const DocumentsView: React.FC<{ onDataChanged: () => void }> = ({ onDataChanged }) => {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [classification, setClassification] = useState('Policy');
  const [version, setVersion] = useState('v1.0');
  const [uploading, setUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<DocumentItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = async () => {
    const res = await apiFetch<DocumentItem[]>('/api/documents');
    setDocs(res);
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('classification', classification);
      fd.append('version', version);
      await apiFetch('/api/documents', { method: 'POST', body: fd });
      await loadDocs();
      onDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Document upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleInspect = async (id: string) => {
    const doc = await apiFetch<DocumentItem>(`/api/documents/${id}`);
    setSelectedDoc(doc);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#0F172A]">Document Center</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Policies, SOPs, control matrices, and compliance manuals parsed, chunked, and indexed for retrieval.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <select
            value={classification}
            onChange={(e) => setClassification(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-medium"
          >
            <option value="Policy">Policy</option>
            <option value="SOP">SOP</option>
            <option value="Control Matrix">Control Matrix</option>
            <option value="Compliance Manual">Compliance Manual</option>
            <option value="Contract">Contract</option>
            <option value="Certification">Certification</option>
          </select>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="Version (e.g. v2.0)"
            className="rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs w-32"
          />
        </div>

        <label className="border border-dashed border-[#CBD5E1] rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-[#F8FAFC] transition-colors">
          <Upload size={22} className="text-[#2563EB] mb-2" />
          <div className="text-sm font-semibold text-[#0F172A]">
            {uploading ? 'Parsing, Chunking & Indexing...' : 'Click to upload compliance document'}
          </div>
          <div className="text-xs text-[#64748B] mt-1">
            Supports PDF, DOC/DOCX, XLS/XLSX, CSV, TXT, MD, HTML, PNG/JPG (Max 10 MB)
          </div>
          <input
            type="file"
            className="hidden"
            onChange={(e) => handleFileUpload(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
                <th className="py-3 px-5">Document</th>
                <th className="py-3 px-4">Classification</th>
                <th className="py-3 px-4">Version</th>
                <th className="py-3 px-4">Owner</th>
                <th className="py-3 px-4 text-right">Chunks</th>
                <th className="py-3 px-5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {docs.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => handleInspect(doc.id)}
                  className="hover:bg-[#F8FAFC] cursor-pointer"
                >
                  <td className="py-3 px-5">
                    <div className="font-semibold text-[#0F172A] flex items-center gap-2">
                      <FileText size={14} className="text-[#2563EB]" />
                      <span>{doc.filename}</span>
                    </div>
                    <div className="text-[#64748B] mt-0.5 line-clamp-1">{doc.summary}</div>
                  </td>
                  <td className="py-3 px-4 text-[#475569]">{doc.classification}</td>
                  <td className="py-3 px-4 font-mono">{doc.version}</td>
                  <td className="py-3 px-4 text-[#475569]">{doc.owner_name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{doc.chunk_count}</td>
                  <td className="py-3 px-5 font-semibold text-emerald-700">{doc.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedDoc && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Extracted Content Preview: {selectedDoc.filename}
            </h2>
            <button
              type="button"
              onClick={() => setSelectedDoc(null)}
              className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] cursor-pointer"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-[#475569]">{selectedDoc.summary}</p>
          <pre className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-4 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
            {selectedDoc.extracted_text}
          </pre>
        </div>
      )}
    </div>
  );
};

// --- 4. Controls Register ---
export const ControlsView: React.FC = () => {
  const [controls, setControls] = useState<ControlItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [dept, setDept] = useState('Engineering');

  const load = () => apiFetch<ControlItem[]>('/api/controls').then(setControls);
  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/controls', {
      method: 'POST',
      body: JSON.stringify({ code, title, ownerDepartment: dept }),
    });
    setCode('');
    setTitle('');
    setShowAdd(false);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">Controls Matrix</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Internal technical and organizational controls mapped to regulatory obligations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Plus size={14} />
          <span>Add Control</span>
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white border border-[#E2E8F0] rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Code</label>
            <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="CTRL-NET-09" className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-mono" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium mb-1">Control Title</label>
            <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Automated TLS 1.3 Certificate Pinning" className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs" />
          </div>
          <div className="flex gap-2">
            <input value={dept} onChange={(e) => setDept(e.target.value)} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs" />
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0F1D3D] text-white text-xs font-semibold cursor-pointer">Save</button>
          </div>
        </form>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
                <th className="py-3 px-5">Code</th>
                <th className="py-3 px-4">Control</th>
                <th className="py-3 px-4">Owner Dept</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-5">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {controls.map((c) => (
                <tr key={c.id} className="hover:bg-[#F8FAFC]">
                  <td className="py-3 px-5 font-mono font-bold text-[#2563EB]">{c.code}</td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-[#0F172A]">{c.title}</div>
                    <div className="text-[#64748B] mt-0.5">{c.description}</div>
                  </td>
                  <td className="py-3 px-4 text-[#475569]">{c.owner_department}</td>
                  <td className="py-3 px-4 font-semibold text-[#0F172A]">{c.status}</td>
                  <td className="py-3 px-5 font-semibold">
                    <span
                      className={
                        c.verification_status === 'Verified'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }
                    >
                      {c.verification_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- 5. Audit Log ---
export const AuditLogView: React.FC = () => {
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    apiFetch<AuditEvent[]>('/api/audit-log').then(setEvents);
  }, []);

  const exportCsv = () => {
    const header = 'Timestamp,Actor,Role,Action,ObjectType,Object,PreviousState,NewState,Source\n';
    const rows = events
      .map((e) =>
        [
          e.timestamp,
          e.actor_name,
          e.actor_role,
          e.action,
          e.object_type,
          e.object_label,
          e.previous_state,
          e.new_state,
          e.source_ref,
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'complianceos-audit-trail.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">Immutable Audit Trail</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Append-only chronological record of every regulatory change, analysis, approval, evidence upload, and verification.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          className="px-4 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <Download size={14} />
          <span>Download CSV</span>
        </button>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
                <th className="py-3 px-5">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Object</th>
                <th className="py-3 px-4">State Transition</th>
                <th className="py-3 px-5">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0] text-xs">
              {events.map((ev) => (
                <tr key={ev.id} className="hover:bg-[#F8FAFC]">
                  <td className="py-3 px-5 font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                    {new Date(ev.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 font-medium text-[#0F172A]">
                    {ev.actor_name}{' '}
                    <span className="text-[#64748B] font-normal">({ev.actor_role})</span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-[#0F172A]">{ev.action}</td>
                  <td className="py-3 px-4 text-[#475569]">
                    {ev.object_type}: {ev.object_label}
                  </td>
                  <td className="py-3 px-4 text-[#475569]">
                    {ev.previous_state} → <span className="font-semibold text-[#0F172A]">{ev.new_state}</span>
                  </td>
                  <td className="py-3 px-5 text-[#64748B]">{ev.source_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- 6. Users & Access ---
export const UsersAccessView: React.FC<{ currentRole: string }> = ({ currentRole }) => {
  const [users, setUsers] = useState<any[]>([]);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('compliance_officer');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const load = () => apiFetch<any[]>('/api/users').then(setUsers);
  useEffect(() => {
    load();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setStatusMsg(null);
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ fullName, email, role, password }),
      });
      setFullName('');
      setEmail('');
      setPassword('');
      setStatusMsg('Workspace member added.');
      load();
    } catch (err: any) {
      setError(err?.message || 'Unable to add user.');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    setError(null);
    setStatusMsg(null);
    try {
      await apiFetch(`/api/users/${resetUserId}/password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });
      setResetUserId(null);
      setResetPasswordVal('');
      setStatusMsg('Member password updated successfully.');
    } catch (err: any) {
      setError(err?.message || 'Unable to reset password.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#0F172A]">Users & Role-Based Access</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Manage organization admins, compliance officers, engineering owners, and read-only auditors.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {statusMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {statusMsg}
        </div>
      )}

      {currentRole === 'org_admin' && (
        <form onSubmit={handleInvite} className="bg-white border border-[#E2E8F0] rounded-xl p-5 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium mb-1">Full Name</label>
            <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Work Email</label>
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs">
              <option value="org_admin">Organization Admin</option>
              <option value="compliance_officer">Compliance Officer</option>
              <option value="engineering">Engineering / Ops</option>
              <option value="auditor">Auditor (Read-Only)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Temp Password</label>
            <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs" />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold cursor-pointer">
            Add Member
          </button>
        </form>
      )}

      {resetUserId && (
        <form onSubmit={handleResetPassword} className="bg-white border border-[#CBD5E1] rounded-xl p-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs font-medium text-[#334155] mb-1">
              New Password for {users.find((u) => u.id === resetUserId)?.email}
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={resetPasswordVal}
              onChange={(e) => setResetPasswordVal(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
            />
          </div>
          <button type="submit" className="px-4 py-2 rounded-lg bg-[#0F1D3D] text-white text-xs font-semibold cursor-pointer">
            Save Password
          </button>
          <button
            type="button"
            onClick={() => {
              setResetUserId(null);
              setResetPasswordVal('');
            }}
            className="px-3 py-2 rounded-lg border border-[#CBD5E1] text-xs font-semibold cursor-pointer"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
              <th className="py-3 px-5">Name</th>
              <th className="py-3 px-4">Email</th>
              <th className="py-3 px-4">Department</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              {currentRole === 'org_admin' && <th className="py-3 px-5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0] text-xs">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-[#F8FAFC]">
                <td className="py-3 px-5 font-semibold text-[#0F172A]">{u.full_name}</td>
                <td className="py-3 px-4 font-mono text-[#475569]">{u.email}</td>
                <td className="py-3 px-4 text-[#475569]">{u.department}</td>
                <td className="py-3 px-4 font-mono text-[#2563EB]">{u.role}</td>
                <td className="py-3 px-4 font-semibold text-emerald-700">{u.status}</td>
                {currentRole === 'org_admin' && (
                  <td className="py-3 px-5 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setResetUserId(u.id);
                        setResetPasswordVal('');
                      }}
                      className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
                    >
                      Reset Password
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// --- 7. Settings & Guardrails ---
export const SettingsView: React.FC<{ organization: Organization }> = ({ organization }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwMsg, setPwMsg] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setSavingPw(true);
    try {
      const res = await apiFetch<{ ok: boolean; token?: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      setCurrentPassword('');
      setNewPassword('');
      setPwMsg({
        type: 'success',
        text: 'Your password has been updated and previous active sessions were invalidated.',
      });
    } catch (err: any) {
      setPwMsg({ type: 'error', text: err?.message || 'Unable to update password.' });
    } finally {
      setSavingPw(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#0F172A]">Workspace Settings</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Tenant isolation, human-approval gates, and account security controls.
        </p>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4 text-xs">
        <div className="flex items-center justify-between py-2 border-b border-[#E2E8F0]">
          <div>
            <div className="font-semibold text-[#0F172A]">Tenant Workspace Isolation</div>
            <div className="text-[#64748B] mt-0.5">
              All queries, documents, embeddings, and audit logs are scoped to {organization.id}.
            </div>
          </div>
          <span className="font-mono font-bold text-emerald-700">ENFORCED</span>
        </div>

        <div className="flex items-center justify-between py-2 border-b border-[#E2E8F0]">
          <div>
            <div className="font-semibold text-[#0F172A]">Human-in-the-Loop Policy Approval</div>
            <div className="text-[#64748B] mt-0.5">
              AI-recommended policy diffs require explicit Compliance Officer or Admin approval.
            </div>
          </div>
          <span className="font-mono font-bold text-emerald-700">REQUIRED</span>
        </div>

        <div className="flex items-center justify-between py-2">
          <div>
            <div className="font-semibold text-[#0F172A]">Decision Support Disclaimer</div>
            <div className="text-[#64748B] mt-0.5">
              ComplianceOS outputs assist compliance teams and do not constitute formal legal certification.
            </div>
          </div>
          <span className="font-mono font-bold text-[#2563EB]">ACTIVE</span>
        </div>
      </div>

      <form
        onSubmit={handleChangePassword}
        className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4 max-w-xl"
      >
        <div>
          <h2 className="font-display text-sm font-bold text-[#0F172A]">
            Update Your Account Password
          </h2>
          <p className="text-xs text-[#64748B] mt-0.5">
            Change your sign-in password for this organization workspace.
          </p>
        </div>

        {pwMsg && (
          <div
            className={`rounded-lg border px-3.5 py-2.5 text-xs font-medium ${
              pwMsg.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {pwMsg.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#334155] mb-1">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#334155] mb-1">
              New Password (min 8 chars)
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={savingPw}
          className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
        >
          {savingPw ? 'Updating...' : 'Update Password'}
        </button>
      </form>
    </div>
  );
};
