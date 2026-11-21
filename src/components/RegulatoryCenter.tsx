import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileDiff,
  FileSearch,
  GitBranch,
  Globe2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../api';
import type {
  NavView,
  RegulationDetail,
  RegulationItem,
  RegulatoryChangeDetail,
  RegulatoryChangeItem,
  RegulatoryDocumentItem,
  RegulatoryIngestionRun,
  RegulatoryObligationItem,
  RegulatorySourceItem,
} from '../types';

interface RegulatoryCenterProps {
  regulations: RegulationItem[];
  selectedRegulationId: string | null;
  onSelectRegulation: (id: string) => void;
  onNavigate: (view: NavView, itemId?: string) => void;
  onDataChanged: () => void;
}

type CenterMode = 'changes' | 'search' | 'sources' | 'workspace';

export const RegulatoryCenter: React.FC<RegulatoryCenterProps> = ({
  regulations,
  selectedRegulationId,
  onSelectRegulation,
  onNavigate,
  onDataChanged,
}) => {
  const [mode, setMode] = useState<CenterMode>(() =>
    selectedRegulationId?.startsWith('reg_') ? 'workspace' : 'changes'
  );

  // Global Regulatory Change Feed & Diff View state
  const [changes, setChanges] = useState<RegulatoryChangeItem[]>([]);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(() =>
    selectedRegulationId?.startsWith('rchg_') ? selectedRegulationId : null
  );
  const [changeDetail, setChangeDetail] = useState<RegulatoryChangeDetail | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [loadingChangeDetail, setLoadingChangeDetail] = useState(false);
  const [changeSearch, setChangeSearch] = useState('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [changeActionBusy, setChangeActionBusy] = useState<'ai' | 'review' | null>(null);

  // Search & Obligations state
  const [docs, setDocs] = useState<RegulatoryDocumentItem[]>([]);
  const [obligations, setObligations] = useState<RegulatoryObligationItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [docJurisdiction, setDocJurisdiction] = useState('');
  const [docOblType, setDocOblType] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);

  // Sources & Ingestion state
  const [sources, setSources] = useState<RegulatorySourceItem[]>([]);
  const [ingestionRuns, setIngestionRuns] = useState<RegulatoryIngestionRun[]>([]);
  const [checkingSourceId, setCheckingSourceId] = useState<string | null>(null);
  const [showIngestForm, setShowIngestForm] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestSourceId, setIngestSourceId] = useState('src_bb_psd');
  const [ingestIdentifier, setIngestIdentifier] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestJurisdiction, setIngestJurisdiction] = useState('Bangladesh');
  const [ingestRegulator, setIngestRegulator] = useState('Bangladesh Bank');
  const [ingestSourceUrl, setIngestSourceUrl] = useState('https://www.bb.org.bd/en/index.php/mediaroom/circulars');
  const [ingestEffectiveDate, setIngestEffectiveDate] = useState('2027-01-01');
  const [ingestContent, setIngestContent] = useState('');
  const [ingestFile, setIngestFile] = useState<File | null>(null);

  // Add Source Form
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceJurisdiction, setNewSourceJurisdiction] = useState('United States');
  const [newSourceRegulator, setNewSourceRegulator] = useState('');
  const [newSourceType, setNewSourceType] = useState('government_website');
  const [newSourceUrl, setNewSourceUrl] = useState('');

  // Workspace Applicability & Policy Diffs state (preserved)
  const [filter, setFilter] = useState<'all' | 'applicable' | 'dismissed'>('all');
  const [detail, setDetail] = useState<RegulationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [aiBusy, setAiBusy] = useState<'applicability' | 'action-plan' | null>(null);
  const [policyBusyId, setPolicyBusyId] = useState<string | null>(null);

  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    if (selectedRegulationId?.startsWith('rchg_')) {
      setMode('changes');
      setSelectedChangeId(selectedRegulationId);
    } else if (selectedRegulationId?.startsWith('reg_')) {
      setMode('workspace');
    }
  }, [selectedRegulationId]);

  const loadChangeFeed = useCallback(async () => {
    setLoadingChanges(true);
    try {
      const params = new URLSearchParams();
      if (changeSearch.trim()) params.set('q', changeSearch.trim());
      if (jurisdictionFilter) params.set('jurisdiction', jurisdictionFilter);
      if (severityFilter) params.set('severity', severityFilter);
      if (unreviewedOnly) params.set('unreviewedOnly', 'true');
      const items = await apiFetch<RegulatoryChangeItem[]>(`/api/regulatory-changes?${params.toString()}`);
      setChanges(items);
      setSelectedChangeId((prev) => {
        if (prev && items.some((i) => i.id === prev)) return prev;
        return items[0]?.id || null;
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Unable to load regulatory changes.' });
    } finally {
      setLoadingChanges(false);
    }
  }, [changeSearch, jurisdictionFilter, severityFilter, unreviewedOnly]);

  const loadChangeDetail = useCallback(async (id: string) => {
    setLoadingChangeDetail(true);
    try {
      const res = await apiFetch<RegulatoryChangeDetail>(`/api/regulatory-changes/${id}`);
      setChangeDetail(res);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Unable to load regulatory diff detail.' });
    } finally {
      setLoadingChangeDetail(false);
    }
  }, []);

  const loadSearchAndObligations = useCallback(async () => {
    setLoadingSearch(true);
    try {
      const docParams = new URLSearchParams();
      if (searchTerm.trim()) docParams.set('q', searchTerm.trim());
      if (docJurisdiction) docParams.set('jurisdiction', docJurisdiction);
      if (docOblType) docParams.set('obligationType', docOblType);

      const oblParams = new URLSearchParams();
      if (searchTerm.trim()) oblParams.set('q', searchTerm.trim());
      if (docJurisdiction) oblParams.set('jurisdiction', docJurisdiction);
      if (docOblType) oblParams.set('obligationType', docOblType);

      const [docsRes, oblRes] = await Promise.all([
        apiFetch<RegulatoryDocumentItem[]>(`/api/regulatory-documents?${docParams.toString()}`),
        apiFetch<RegulatoryObligationItem[]>(`/api/obligations?${oblParams.toString()}`),
      ]);
      setDocs(docsRes);
      setObligations(oblRes);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Search failed.' });
    } finally {
      setLoadingSearch(false);
    }
  }, [searchTerm, docJurisdiction, docOblType]);

  const loadSourcesAndRuns = useCallback(async () => {
    try {
      const res = await apiFetch<{ sources: RegulatorySourceItem[]; recentRuns: RegulatoryIngestionRun[] }>(
        '/api/regulatory-sources'
      );
      setSources(res.sources);
      setIngestionRuns(res.recentRuns);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Unable to load monitored sources.' });
    }
  }, []);

  useEffect(() => {
    if (mode === 'changes') {
      loadChangeFeed();
    } else if (mode === 'search') {
      loadSearchAndObligations();
    } else if (mode === 'sources') {
      loadSourcesAndRuns();
    }
  }, [mode, loadChangeFeed, loadSearchAndObligations, loadSourcesAndRuns]);

  useEffect(() => {
    if (mode === 'changes' && selectedChangeId) {
      loadChangeDetail(selectedChangeId);
    }
  }, [mode, selectedChangeId, loadChangeDetail]);

  // Workspace regulations detail loader
  const activeWsRegId =
    selectedRegulationId && selectedRegulationId.startsWith('reg_')
      ? selectedRegulationId
      : regulations[0]?.id || null;

  const loadWorkspaceDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    try {
      const res = await apiFetch<RegulationDetail>(`/api/regulations/${id}`);
      setDetail(res);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Unable to load regulation detail.' });
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'workspace' && activeWsRegId) {
      loadWorkspaceDetail(activeWsRegId);
    }
  }, [mode, activeWsRegId, loadWorkspaceDetail]);

  const handleRunLiveAiOnChange = async () => {
    if (!changeDetail) return;
    setChangeActionBusy('ai');
    setFeedback(null);
    try {
      const res = await apiFetch<{
        aiSummary: any;
        extractedObligationsCount: number;
      }>(`/api/regulatory-changes/${changeDetail.change.id}/analyze`, { method: 'POST' });
      await loadChangeDetail(changeDetail.change.id);
      await loadChangeFeed();
      setFeedback({
        type: 'success',
        message: res.aiSummary?.ai_generated
          ? `Gemini regulatory interpretation completed (${res.extractedObligationsCount} obligations).`
          : `Deterministic change summary refreshed (${res.extractedObligationsCount} obligations; Gemini API key not configured).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'AI change analysis failed.' });
    } finally {
      setChangeActionBusy(null);
    }
  };

  const handleReviewChange = async (reviewStatus: 'REVIEWED' | 'APPLICABLE' | 'NOT_APPLICABLE') => {
    if (!changeDetail) return;
    setChangeActionBusy('review');
    setFeedback(null);
    try {
      await apiFetch(`/api/regulatory-changes/${changeDetail.change.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ reviewStatus }),
      });
      await loadChangeDetail(changeDetail.change.id);
      await loadChangeFeed();
      onDataChanged();
      setFeedback({ type: 'success', message: `Change status updated to ${reviewStatus}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Unable to update review status.' });
    } finally {
      setChangeActionBusy(null);
    }
  };

  const handleCheckSource = async (sourceId: string) => {
    setCheckingSourceId(sourceId);
    setFeedback(null);
    try {
      const outcome = await apiFetch<{
        status: string;
        message: string;
        versionNumber?: number;
        changeId?: string;
      }>(`/api/regulatory-sources/${sourceId}/check`, { method: 'POST' });
      await loadSourcesAndRuns();
      onDataChanged();
      setFeedback({
        type: outcome.status === 'FAILED' ? 'error' : 'success',
        message: `${outcome.status}: ${outcome.message}`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Source check failed.' });
    } finally {
      setCheckingSourceId(null);
    }
  };

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      await apiFetch('/api/regulatory-sources', {
        method: 'POST',
        body: JSON.stringify({
          name: newSourceName,
          jurisdiction: newSourceJurisdiction,
          regulator: newSourceRegulator,
          sourceType: newSourceType,
          sourceUrl: newSourceUrl,
        }),
      });
      setNewSourceName('');
      setNewSourceRegulator('');
      setNewSourceUrl('');
      setShowAddSource(false);
      await loadSourcesAndRuns();
      onDataChanged();
      setFeedback({ type: 'success', message: 'Regulatory source added to monitoring registry.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Failed to add regulatory source.' });
    }
  };

  const handleIngestDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestBusy(true);
    setFeedback(null);
    try {
      const formData = new FormData();
      formData.append('sourceId', ingestSourceId);
      formData.append('regulatoryIdentifier', ingestIdentifier);
      formData.append('title', ingestTitle);
      formData.append('jurisdiction', ingestJurisdiction);
      formData.append('regulator', ingestRegulator);
      formData.append('sourceUrl', ingestSourceUrl);
      formData.append('effectiveDate', ingestEffectiveDate);
      if (ingestFile) {
        formData.append('file', ingestFile);
      } else {
        formData.append('content', ingestContent);
      }

      const token = getAuthToken();
      const response = await fetch('/api/regulatory-documents/ingest', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || payload?.message || 'Ingestion failed.');
      }

      await loadSourcesAndRuns();
      await loadChangeFeed();
      onDataChanged();
      setShowIngestForm(false);
      setIngestFile(null);
      setIngestContent('');

      if (payload.changeId) {
        setSelectedChangeId(payload.changeId);
        setMode('changes');
      }
      setFeedback({
        type: 'success',
        message: `${payload.status}: ${payload.message}`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Regulatory document ingestion failed.' });
    } finally {
      setIngestBusy(false);
    }
  };

  // Existing workspace applicability & policy diff handlers
  const filteredRegs = regulations.filter((r) => {
    if (filter === 'applicable') return r.applicability_status !== 'Not Applicable';
    if (filter === 'dismissed') return r.applicability_status === 'Not Applicable';
    return true;
  });

  const handleRunAiApplicability = async () => {
    if (!detail) return;
    setAiBusy('applicability');
    setFeedback(null);
    try {
      await apiFetch('/api/analysis/applicability', {
        method: 'POST',
        body: JSON.stringify({ regulationId: detail.regulation.id }),
      });
      await loadWorkspaceDetail(detail.regulation.id);
      onDataChanged();
      setFeedback({ type: 'success', message: 'Gemini applicability evaluation updated and logged.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Applicability analysis failed.' });
    } finally {
      setAiBusy(null);
    }
  };

  const handleGenerateActionPlan = async () => {
    if (!detail) return;
    setAiBusy('action-plan');
    setFeedback(null);
    try {
      const res = await apiFetch<{ createdActions: any[] }>('/api/action-plans', {
        method: 'POST',
        body: JSON.stringify({ regulationId: detail.regulation.id }),
      });
      await loadWorkspaceDetail(detail.regulation.id);
      onDataChanged();
      setFeedback({
        type: 'success',
        message: `Generated ${res.createdActions.length} remediation actions via Gemini.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Action plan generation failed.' });
    } finally {
      setAiBusy(null);
    }
  };

  const handlePolicyDecision = async (
    policyId: string,
    decision: 'Approve' | 'Reject' | 'Request Changes'
  ) => {
    setPolicyBusyId(policyId);
    setFeedback(null);
    try {
      await apiFetch(`/api/policies/${policyId}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      if (detail) {
        await loadWorkspaceDetail(detail.regulation.id);
      }
      onDataChanged();
      setFeedback({ type: 'success', message: `Policy decision recorded: ${decision}.` });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || 'Policy update failed.' });
    } finally {
      setPolicyBusyId(null);
    }
  };

  const latestVersion = detail?.versions?.[0];

  return (
    <div className="space-y-6">
      {/* Top Header + Mode Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Regulatory Intelligence &amp; Change Detection
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Multi-jurisdiction source monitoring, immutable regulatory versions, deterministic diffs, and extracted compliance obligations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-white border border-[#E2E8F0] rounded-lg self-start">
          {[
            { id: 'changes', label: 'Regulatory Change Feed', icon: FileDiff },
            { id: 'search', label: 'Search & Obligations', icon: FileSearch },
            { id: 'sources', label: 'Sources & Ingestion', icon: Radio },
            { id: 'workspace', label: 'Workspace Applicability & Policies', icon: ShieldAlert },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFeedback(null);
                  setMode(tab.id as CenterMode);
                }}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  mode === tab.id
                    ? 'bg-[#0F1D3D] text-white'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                <Icon size={13} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* MODE 1: REGULATORY CHANGE FEED + DIFF VIEW */}
      {mode === 'changes' && (
        <div className="space-y-4">
          {/* Feed Filters */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
              <input
                type="search"
                value={changeSearch}
                onChange={(e) => setChangeSearch(e.target.value)}
                placeholder="Filter changes by identifier, regulator, keyword..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#2563EB]"
              />
            </div>

            <select
              value={jurisdictionFilter}
              onChange={(e) => setJurisdictionFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-white text-[#0F172A]"
            >
              <option value="">All Jurisdictions</option>
              <option value="Bangladesh">Bangladesh</option>
              <option value="United States">United States</option>
              <option value="European Union">European Union</option>
              <option value="United Kingdom">United Kingdom</option>
            </select>

            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-white text-[#0F172A]"
            >
              <option value="">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>

            <label className="flex items-center gap-1.5 text-xs font-medium text-[#334155] cursor-pointer">
              <input
                type="checkbox"
                checked={unreviewedOnly}
                onChange={(e) => setUnreviewedOnly(e.target.checked)}
                className="rounded border-[#CBD5E1]"
              />
              <span>Unreviewed only</span>
            </label>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Regulatory Change Feed */}
            <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#E2E8F0]">
              {loadingChanges ? (
                <div className="p-6 text-xs text-[#64748B]">Loading regulatory changes...</div>
              ) : changes.length === 0 ? (
                <div className="p-6 text-xs text-[#64748B]">No regulatory changes match your filters.</div>
              ) : (
                changes.map((ch) => {
                  const active = ch.id === selectedChangeId;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setSelectedChangeId(ch.id)}
                      className={`w-full text-left p-4 transition-colors cursor-pointer ${
                        active ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono font-bold text-[#0F172A]">{ch.regulatory_identifier}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-semibold">
                            {ch.change_type}
                          </span>
                          <span
                            className={`font-semibold ${
                              ch.severity === 'Critical'
                                ? 'text-red-700'
                                : ch.severity === 'High'
                                ? 'text-amber-700'
                                : 'text-[#2563EB]'
                            }`}
                          >
                            {ch.severity}
                          </span>
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-[#0F172A] mt-1 leading-snug">
                        {ch.regulation_title}
                      </div>
                      <p className="text-xs text-[#475569] mt-1 line-clamp-2">
                        {ch.aiSummary?.summary || ch.diff_summary_text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#64748B] mt-2.5">
                        <span className="font-medium text-[#334155]">{ch.regulator}</span>
                        <span>·</span>
                        <span>{ch.jurisdiction}</span>
                        <span>·</span>
                        <span className="font-mono">{ch.change_date}</span>
                        <span>·</span>
                        <span className="tabular-nums">{ch.affected_obligation_count} obligations</span>
                        {ch.org_review_status === 'UNREVIEWED' && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold">
                            Unreviewed
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Right: Dedicated Regulatory Diff View */}
            <div className="lg:col-span-8 space-y-5">
              {loadingChangeDetail || !changeDetail ? (
                <div className="h-96 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />
              ) : (
                <>
                  {/* Provenance & Review Header */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                          <span className="font-semibold text-[#0F172A]">{changeDetail.change.regulator}</span>
                          <span>·</span>
                          <span className="font-mono font-semibold text-[#2563EB]">
                            {changeDetail.change.regulatory_identifier}
                          </span>
                          <span>·</span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#334155] font-medium">
                            {changeDetail.change.jurisdiction}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-semibold">
                            {changeDetail.change.change_type}
                          </span>
                          {changeDetail.change.is_demo === 1 && (
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#475569] font-mono text-[10px] font-semibold">
                              DEMO / SYNTHETIC
                            </span>
                          )}
                        </div>
                        <h2 className="font-display text-xl font-bold text-[#0F172A] mt-1.5">
                          {changeDetail.change.regulation_title}
                        </h2>

                        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3">
                          <div>
                            <span className="text-[#64748B]">Publication / Effective:</span>{' '}
                            <span className="font-mono text-[#0F172A]">
                              {changeDetail.newVersion?.publication_date} / {changeDetail.newVersion?.effective_date}
                            </span>
                          </div>
                          <div>
                            <span className="text-[#64748B]">Content Hash (SHA-256):</span>{' '}
                            <span className="font-mono text-[#0F172A]">
                              {changeDetail.newVersion?.content_hash.slice(0, 16)}...
                            </span>
                          </div>
                          <div className="truncate">
                            <span className="text-[#64748B]">Source:</span>{' '}
                            <a
                              href={changeDetail.change.source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#2563EB] hover:underline inline-flex items-center gap-1"
                            >
                              <span>{changeDetail.change.source_name || 'Official Feed'}</span>
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={changeActionBusy !== null}
                          onClick={handleRunLiveAiOnChange}
                          className="px-3 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Sparkles size={13} />
                          <span>
                            {changeActionBusy === 'ai' ? 'Analyzing...' : 'Run Gemini Analysis'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={changeActionBusy !== null}
                          onClick={() => handleReviewChange('REVIEWED')}
                          className="px-3 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 size={13} className="text-emerald-600" />
                          <span>
                            {changeDetail.organizationReview.review_status === 'UNREVIEWED'
                              ? 'Mark Reviewed'
                              : `Status: ${changeDetail.organizationReview.review_status}`}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Immutable Version History Timeline */}
                    {changeDetail.versionHistory.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-[#E2E8F0]">
                        <div className="text-[11px] font-semibold text-[#64748B] mb-2">
                          Immutable Version History
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {changeDetail.versionHistory.map((ver, idx) => (
                            <React.Fragment key={ver.id}>
                              <div className="px-2.5 py-1.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] text-[11px]">
                                <span className="font-mono font-bold text-[#0F172A]">v{ver.version_number}</span>{' '}
                                <span className="text-[#2563EB] font-semibold">({ver.change_status})</span>{' '}
                                <span className="font-mono text-[#64748B]">· {ver.content_hash.slice(0, 8)}</span>
                              </div>
                              {idx < changeDetail.versionHistory.length - 1 && (
                                <ArrowRight size={12} className="text-[#64748B]" />
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* SOURCE TEXT: Old Version vs New Version Side-by-Side Diff */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileDiff size={16} className="text-[#2563EB]" />
                        <h3 className="font-display text-sm font-bold text-[#0F172A]">
                          Regulatory Source Diff (Exact Source Text)
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-[11px] font-mono font-semibold text-[#334155]">
                        SOURCE TEXT · DETERMINISTIC DIFF
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
                        <div className="text-xs font-bold text-red-800 mb-2 flex items-center justify-between">
                          <span>
                            OLD VERSION {changeDetail.oldVersion ? `(v${changeDetail.oldVersion.version_number})` : '(None)'}
                          </span>
                          {changeDetail.oldVersion && (
                            <span className="font-mono text-[10px]">
                              {changeDetail.oldVersion.publication_date}
                            </span>
                          )}
                        </div>
                        <pre className="whitespace-pre-wrap font-sans text-xs text-[#334155] leading-relaxed max-h-64 overflow-y-auto">
                          {changeDetail.oldVersion?.extracted_text ||
                            'No prior version existed. This is a newly issued regulatory instrument.'}
                        </pre>
                      </div>

                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                        <div className="text-xs font-bold text-emerald-800 mb-2 flex items-center justify-between">
                          <span>
                            NEW VERSION (v{changeDetail.newVersion?.version_number || 1})
                          </span>
                          {changeDetail.newVersion && (
                            <span className="font-mono text-[10px]">
                              {changeDetail.newVersion.publication_date}
                            </span>
                          )}
                        </div>
                        <pre className="whitespace-pre-wrap font-sans text-xs text-[#0F172A] leading-relaxed max-h-64 overflow-y-auto">
                          {changeDetail.newVersion?.extracted_text}
                        </pre>
                      </div>
                    </div>

                    {/* Structured Deterministic Diff Items */}
                    {changeDetail.change.structuredDiff.length > 0 && (
                      <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
                        <div className="text-xs font-semibold text-[#475569]">
                          Structured Provision Changes ({changeDetail.change.structuredDiff.length})
                        </div>
                        <div className="space-y-2">
                          {changeDetail.change.structuredDiff.map((item, idx) => (
                            <div
                              key={idx}
                              className="border border-[#E2E8F0] rounded-lg p-3 bg-[#F8FAFC] text-xs space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                                      item.change_type === 'ADDED'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : item.change_type === 'REMOVED'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {item.change_type}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-mono text-[10px] font-semibold">
                                    {item.category}
                                  </span>
                                  <span className="font-semibold text-[#0F172A]">{item.section}</span>
                                </div>
                                <span className="text-[11px] font-semibold text-[#475569]">
                                  Severity: {item.severity}
                                </span>
                              </div>
                              {item.old_value && (
                                <div className="text-red-800 bg-red-50/70 px-2.5 py-1.5 rounded border border-red-100">
                                  <span className="font-bold">Old: </span>
                                  {item.old_value}
                                </div>
                              )}
                              {item.new_value && (
                                <div className="text-emerald-900 bg-emerald-50/70 px-2.5 py-1.5 rounded border border-emerald-100">
                                  <span className="font-bold">New: </span>
                                  {item.new_value}
                                </div>
                              )}
                              <div className="text-[11px] font-mono text-[#64748B]">
                                Citation: {item.citation}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* AI INTERPRETATION & RECOMMENDED ACTION (Explicitly Separated from Source Text) */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Sparkles size={16} className="text-[#2563EB]" />
                        <h3 className="font-display text-sm font-bold text-[#0F172A]">
                          Change Interpretation &amp; Compliance Review Guidance
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-blue-50 text-[11px] font-mono font-semibold text-[#2563EB]">
                        {changeDetail.change.aiSummary?.ai_generated
                          ? `AI INTERPRETATION (${changeDetail.change.aiSummary.model_name || 'Gemini'})`
                          : 'DETERMINISTIC INTERPRETATION'}
                      </span>
                    </div>

                    {changeDetail.change.aiSummary ? (
                      <div className="space-y-4 text-xs">
                        {changeDetail.change.aiSummary.insufficient_evidence && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 flex items-center gap-2">
                            <AlertCircle size={14} />
                            <span>
                              INSUFFICIENT_SOURCE_EVIDENCE: Some conclusions were withheld because supporting regulatory text was not present.
                            </span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="border border-[#E2E8F0] rounded-lg p-3.5 bg-[#F8FAFC]">
                            <div className="font-bold text-[#0F172A] mb-1">WHAT CHANGED</div>
                            <p className="text-[#334155] leading-relaxed">
                              {changeDetail.change.aiSummary.summary}
                            </p>
                          </div>
                          <div className="border border-[#E2E8F0] rounded-lg p-3.5 bg-[#F8FAFC]">
                            <div className="font-bold text-[#0F172A] mb-1">WHY IT MATTERS</div>
                            <p className="text-[#334155] leading-relaxed">
                              {changeDetail.change.aiSummary.meaning}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="border border-[#E2E8F0] rounded-lg p-3.5">
                            <div className="font-bold text-[#0F172A] mb-1.5">WHO MAY BE AFFECTED</div>
                            <div className="flex flex-wrap gap-1.5 mb-2">
                              {changeDetail.change.aiSummary.affected_entities.map((ent, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 rounded bg-slate-100 text-[#0F172A] font-medium"
                                >
                                  {ent}
                                </span>
                              ))}
                            </div>
                            <p className="text-[#475569]">{changeDetail.change.aiSummary.potential_impact}</p>
                          </div>

                          <div className="border border-[#E2E8F0] rounded-lg p-3.5">
                            <div className="font-bold text-[#0F172A] mb-1.5">WHAT SHOULD BE REVIEWED (RECOMMENDED ACTION)</div>
                            <ul className="space-y-1 text-[#334155] list-disc pl-4">
                              {changeDetail.change.aiSummary.recommended_review.map((rec, i) => (
                                <li key={i}>{rec}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#64748B]">
                        Click "Run Gemini Analysis" to generate grounded semantic interpretation for this change.
                      </p>
                    )}
                  </div>

                  {/* Extracted Compliance Obligations */}
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-display text-sm font-bold text-[#0F172A]">
                          Extracted Compliance Obligations ({changeDetail.obligations.length})
                        </h3>
                        <p className="text-xs text-[#64748B]">
                          Structured obligations linked to this regulatory version and source citations
                        </p>
                      </div>
                    </div>

                    {changeDetail.obligations.length === 0 ? (
                      <p className="text-xs text-[#64748B]">
                        No structured obligations linked to this version yet.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {changeDetail.obligations.map((obl) => (
                          <div key={obl.id} className="border border-[#E2E8F0] rounded-lg p-4 space-y-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded bg-[#0F1D3D] text-white font-mono text-[10px] font-bold">
                                  {obl.obligation_type}
                                </span>
                                <span className="font-semibold text-sm text-[#0F172A]">{obl.title}</span>
                              </div>
                              <span className="font-mono text-[11px] text-[#64748B]">
                                {obl.extraction_method || obl.change_status || 'ACTIVE'} · Confidence: {obl.confidence}
                              </span>
                            </div>
                            <p className="text-[#334155] leading-relaxed">{obl.description}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px] text-[#475569]">
                              <div>
                                <span className="font-semibold text-[#0F172A]">Deadline:</span> {obl.deadline}
                              </div>
                              <div>
                                <span className="font-semibold text-[#0F172A]">Frequency:</span> {obl.frequency}
                              </div>
                              <div>
                                <span className="font-semibold text-[#0F172A]">Responsible:</span> {obl.responsible_entity}
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                              <div className="text-[11px] font-mono text-[#64748B]">
                                Source Reference: {obl.source_reference} · Evidence: {obl.evidenceRequired.join(', ')}
                              </div>
                              <button
                                type="button"
                                onClick={() => onNavigate('applicability', obl.id)}
                                className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] font-semibold text-[#0F172A] cursor-pointer"
                              >
                                Inspect Applicability
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Regulatory Knowledge Graph Lineage */}
                  {changeDetail.lineage && (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <GitBranch size={15} className="text-[#2563EB]" />
                        <h3 className="font-display text-sm font-bold text-[#0F172A]">
                          Regulatory Lineage Graph ({changeDetail.lineage.nodes.length} nodes · {changeDetail.lineage.edges.length} edges)
                        </h3>
                      </div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {changeDetail.lineage.edges.slice(0, 8).map((edge, idx) => (
                          <span
                            key={idx}
                            className="px-2.5 py-1 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] font-mono text-[#334155]"
                          >
                            {edge.relationship}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: SEARCH REGULATIONS & OBLIGATIONS */}
      {mode === 'search' && (
        <div className="space-y-5">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search regulations, identifiers, topics, or obligations..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] focus:bg-white focus:outline-none focus:border-[#2563EB]"
              />
            </div>
            <select
              value={docJurisdiction}
              onChange={(e) => setDocJurisdiction(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-white text-[#0F172A]"
            >
              <option value="">All Jurisdictions</option>
              <option value="Bangladesh">Bangladesh</option>
              <option value="United States">United States</option>
              <option value="European Union">European Union</option>
              <option value="United Kingdom">United Kingdom</option>
            </select>
            <select
              value={docOblType}
              onChange={(e) => setDocOblType(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-white text-[#0F172A]"
            >
              <option value="">All Obligation Types</option>
              {[
                'REPORT',
                'DISCLOSE',
                'RETAIN',
                'MONITOR',
                'NOTIFY',
                'OBTAIN_APPROVAL',
                'IMPLEMENT_CONTROL',
                'MAINTAIN_RECORD',
                'CONDUCT_ASSESSMENT',
                'FILE_RETURN',
                'PROTECT_DATA',
              ].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center justify-between">
                <h2 className="font-display text-sm font-bold text-[#0F172A]">
                  Tracked Regulatory Documents ({docs.length})
                </h2>
                {loadingSearch && <span className="text-xs text-[#64748B]">Searching...</span>}
              </div>
              <div className="divide-y divide-[#E2E8F0]">
                {docs.map((doc) => (
                  <div key={doc.id} className="p-4 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#2563EB]">{doc.regulatory_identifier}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#334155] font-medium">
                          {doc.jurisdiction}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-semibold">
                          v{doc.current_version_number} · {doc.latest_change_status}
                        </span>
                      </div>
                      <span className="font-mono text-[#64748B]">{doc.obligation_count} obligations</span>
                    </div>
                    <div className="text-sm font-semibold text-[#0F172A]">{doc.title}</div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[#64748B]">
                        {doc.regulator} · Effective {doc.effective_date} · Hash {doc.content_hash.slice(0, 12)}...
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setChangeSearch(doc.regulatory_identifier);
                          setMode('changes');
                        }}
                        className="px-2.5 py-1 rounded border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] text-[11px] font-semibold text-[#0F172A] cursor-pointer"
                      >
                        View Changes
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#E2E8F0]">
                <h2 className="font-display text-sm font-bold text-[#0F172A]">
                  Structured Compliance Obligations ({obligations.length})
                </h2>
              </div>
              <div className="divide-y divide-[#E2E8F0] max-h-[600px] overflow-y-auto">
                {obligations.map((obl) => (
                  <div key={obl.id} className="p-4 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="px-2 py-0.5 rounded bg-[#0F1D3D] text-white font-mono text-[10px] font-bold">
                        {obl.obligation_type}
                      </span>
                      <span className="font-mono text-[#64748B]">
                        {obl.regulatory_identifier} · {obl.jurisdiction}
                      </span>
                    </div>
                    <div className="font-semibold text-[#0F172A] text-sm">{obl.title}</div>
                    <p className="text-[#475569]">{obl.description}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="text-[11px] text-[#64748B]">
                        Deadline: <span className="text-[#0F172A] font-medium">{obl.deadline}</span> · Ref:{' '}
                        <span className="font-mono">{obl.source_reference}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('applicability', obl.id)}
                        className="px-2.5 py-1 rounded border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] text-[11px] font-semibold text-[#0F172A] cursor-pointer"
                      >
                        Inspect Applicability
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 3: MONITORED SOURCES & INGESTION */}
      {mode === 'sources' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[#64748B]">
              Monitor global regulatory sources across jurisdictions and ingest new or updated regulations into immutable versions.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowAddSource(!showAddSource)}
                className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
              >
                <Plus size={14} />
                <span>Add Regulatory Source</span>
              </button>
              <button
                type="button"
                onClick={() => setShowIngestForm(!showIngestForm)}
                className="px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload size={14} />
                <span>Ingest Document / New Version</span>
              </button>
            </div>
          </div>

          {showAddSource && (
            <form onSubmit={handleCreateSource} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
              <div className="font-display text-sm font-bold text-[#0F172A]">Add Monitored Regulatory Source</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <input
                  required
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="Source Name (e.g., MAS Notices)"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  required
                  value={newSourceJurisdiction}
                  onChange={(e) => setNewSourceJurisdiction(e.target.value)}
                  placeholder="Jurisdiction (e.g., United States, Singapore)"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  required
                  value={newSourceRegulator}
                  onChange={(e) => setNewSourceRegulator(e.target.value)}
                  placeholder="Regulator Name"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <select
                  value={newSourceType}
                  onChange={(e) => setNewSourceType(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1] bg-white"
                >
                  <option value="government_website">Government Website</option>
                  <option value="gazette">Official Gazette</option>
                  <option value="circular">Regulatory Circular</option>
                  <option value="regulation_database">Regulation Database</option>
                  <option value="api">API Feed</option>
                  <option value="rss_atom">RSS/Atom Feed</option>
                  <option value="uploaded_document">Uploaded Document</option>
                </select>
                <input
                  required
                  type="url"
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  placeholder="https://regulator.gov/feed"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1] sm:col-span-2"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddSource(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#0F1D3D] text-white text-xs font-semibold cursor-pointer"
                >
                  Save Source
                </button>
              </div>
            </form>
          )}

          {showIngestForm && (
            <form onSubmit={handleIngestDocument} className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
              <div className="font-display text-sm font-bold text-[#0F172A]">
                Ingest Regulatory Document or Publish New Version
              </div>
              <p className="text-xs text-[#64748B]">
                Provide an existing Regulatory Identifier to automatically create an immutable v(n+1) diff, or a new identifier to track a new regulation.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <select
                  value={ingestSourceId}
                  onChange={(e) => setIngestSourceId(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1] bg-white"
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.jurisdiction})
                    </option>
                  ))}
                </select>
                <input
                  required
                  value={ingestIdentifier}
                  onChange={(e) => setIngestIdentifier(e.target.value)}
                  placeholder="Regulatory Identifier (e.g., BB-PSD-09/2026)"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  required
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                  placeholder="Regulation Title"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  required
                  value={ingestJurisdiction}
                  onChange={(e) => setIngestJurisdiction(e.target.value)}
                  placeholder="Jurisdiction"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  required
                  value={ingestRegulator}
                  onChange={(e) => setIngestRegulator(e.target.value)}
                  placeholder="Regulator"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  type="date"
                  value={ingestEffectiveDate}
                  onChange={(e) => setIngestEffectiveDate(e.target.value)}
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1]"
                />
                <input
                  value={ingestSourceUrl}
                  onChange={(e) => setIngestSourceUrl(e.target.value)}
                  placeholder="Official Source URL"
                  className="px-3 py-2 rounded-lg border border-[#CBD5E1] sm:col-span-2"
                />
                <input
                  type="file"
                  accept=".txt,.md,.html,.htm,.json,.xml,.csv,.pdf"
                  onChange={(e) => setIngestFile(e.target.files?.[0] || null)}
                  className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC]"
                />
              </div>
              <textarea
                rows={5}
                value={ingestContent}
                onChange={(e) => setIngestContent(e.target.value)}
                placeholder="Paste regulatory text or HTML/JSON content (optional if uploading a file)..."
                className="w-full px-3 py-2 rounded-lg border border-[#CBD5E1] text-xs font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIngestForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-[#CBD5E1] text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={ingestBusy}
                  className="px-4 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
                >
                  {ingestBusy ? 'Ingesting & Diffing...' : 'Run Ingestion Pipeline'}
                </button>
              </div>
            </form>
          )}

          {/* Sources Table */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0]">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Monitored Regulatory Sources ({sources.length})
              </h2>
            </div>
            <div className="divide-y divide-[#E2E8F0]">
              {sources.map((src) => (
                <div
                  key={src.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Globe2 size={13} className="text-[#2563EB]" />
                      <span className="font-semibold text-sm text-[#0F172A]">{src.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#334155] font-medium">
                        {src.jurisdiction}
                        {src.state_province ? ` (${src.state_province})` : ''}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-mono text-[10px]">
                        {src.source_type}
                      </span>
                      {src.is_demo === 1 && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#64748B] font-mono text-[10px]">
                          DEMO / SYNTHETIC
                        </span>
                      )}
                    </div>
                    <div className="text-[#475569]">{src.description}</div>
                    <div className="font-mono text-[11px] text-[#64748B] flex flex-wrap gap-3">
                      <span>Frequency: {src.monitoring_frequency}</span>
                      <span>Last Checked: {src.last_checked_at ? new Date(src.last_checked_at).toLocaleString() : 'Never'}</span>
                      {src.last_content_hash && <span>Hash: {src.last_content_hash.slice(0, 12)}...</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={checkingSourceId === src.id}
                    onClick={() => handleCheckSource(src.id)}
                    className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <RefreshCw size={13} className={checkingSourceId === src.id ? 'animate-spin' : ''} />
                    <span>{checkingSourceId === src.id ? 'Checking...' : 'Check Source'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Observability Pipeline Run History */}
          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E2E8F0] flex items-center gap-2">
              <Clock size={14} className="text-[#2563EB]" />
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Ingestion Pipeline Observability ({ingestionRuns.length} recent runs)
              </h2>
            </div>
            <div className="divide-y divide-[#E2E8F0] max-h-80 overflow-y-auto">
              {ingestionRuns.map((run) => (
                <div key={run.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          run.status === 'FAILED'
                            ? 'bg-red-100 text-red-800'
                            : run.status === 'NEW_VERSION'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-[#334155]'
                        }`}
                      >
                        {run.status}
                      </span>
                      <span className="font-semibold text-[#0F172A]">{run.source_name || run.source_id}</span>
                      {run.jurisdiction && <span className="text-[#64748B]">({run.jurisdiction})</span>}
                    </div>
                    {run.error_message && <div className="text-red-700 mt-1">{run.error_message}</div>}
                  </div>
                  <div className="font-mono text-[11px] text-[#64748B] tabular-nums">
                    {run.versions_created}v · {run.changes_detected}c · {run.obligations_extracted}o ·{' '}
                    {new Date(run.started_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODE 4: WORKSPACE APPLICABILITY & POLICY DIFFS (Existing functionality preserved) */}
      {mode === 'workspace' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-[#64748B]">
              Organization-scoped regulatory applicability, control/system impact lineage, and human-in-the-loop policy diffs.
            </p>
            <div className="flex items-center gap-1 p-1 bg-white border border-[#E2E8F0] rounded-lg">
              {[
                { id: 'all', label: 'All Changes' },
                { id: 'applicable', label: 'Applicable' },
                { id: 'dismissed', label: 'Dismissed' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id as any)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    filter === tab.id
                      ? 'bg-[#0F1D3D] text-white'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-4 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#E2E8F0]">
              {filteredRegs.map((reg) => {
                const active = reg.id === activeWsRegId;
                return (
                  <button
                    key={reg.id}
                    type="button"
                    onClick={() => onSelectRegulation(reg.id)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      active ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#0F172A]">{reg.code}</span>
                      <span
                        className={`font-semibold ${
                          reg.severity === 'Critical'
                            ? 'text-red-700'
                            : reg.severity === 'High'
                            ? 'text-amber-700'
                            : reg.severity === 'Medium'
                            ? 'text-[#2563EB]'
                            : 'text-[#64748B]'
                        }`}
                      >
                        {reg.severity} Impact
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[#0F172A] mt-1 leading-snug">
                      {reg.title}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#64748B] mt-2">
                      <span>{reg.regulator}</span>
                      <span aria-hidden="true">·</span>
                      <span>{reg.applicability_status}</span>
                      <span aria-hidden="true">·</span>
                      <span>{reg.status}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="lg:col-span-8 space-y-6">
              {loadingDetail || !detail ? (
                <div className="h-96 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />
              ) : (
                <>
                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[#64748B]">
                          <span className="font-semibold text-[#0F172A]">
                            {detail.regulation.regulator}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{detail.regulation.code}</span>
                          <span aria-hidden="true">·</span>
                          <span>{detail.regulation.jurisdiction}</span>
                          <span aria-hidden="true">·</span>
                          <span>Effective {detail.regulation.effective_date}</span>
                        </div>
                        <h2 className="font-display text-xl font-bold text-[#0F172A] mt-1.5">
                          {detail.regulation.title}
                        </h2>
                        <p className="text-sm text-[#475569] mt-2 leading-relaxed">
                          {detail.regulation.summary}
                        </p>
                        <div className="mt-3 text-xs text-[#64748B] font-mono">
                          Source hash: {detail.regulation.content_hash} · Demo fixture
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onNavigate('knowledge-graph', detail.regulation.id)}
                          className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
                        >
                          <GitBranch size={14} className="text-[#2563EB]" />
                          <span>Knowledge Graph</span>
                        </button>
                        <button
                          type="button"
                          disabled={aiBusy !== null}
                          onClick={handleRunAiApplicability}
                          className="px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <RefreshCw size={13} className={aiBusy === 'applicability' ? 'animate-spin' : ''} />
                          <span>
                            {aiBusy === 'applicability'
                              ? 'Analyzing...'
                              : 'Re-run AI Applicability'}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {latestVersion && (
                    <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <FileDiff size={16} className="text-[#2563EB]" />
                          <h3 className="font-display text-sm font-bold text-[#0F172A]">
                            What Changed? (Version {latestVersion.version_number} Diff)
                          </h3>
                        </div>
                        <span className="text-xs font-mono text-[#64748B]">
                          Published {latestVersion.published_at}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="rounded-lg border border-red-200 bg-red-50/40 p-4">
                          <div className="text-xs font-bold text-red-800 mb-2">PREVIOUS</div>
                          <p className="text-sm text-[#334155] leading-relaxed">
                            {latestVersion.diff_previous_text}
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                          <div className="text-xs font-bold text-emerald-800 mb-2">NEW</div>
                          <p className="text-sm text-[#0F172A] leading-relaxed font-medium">
                            {latestVersion.diff_new_text}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-display text-sm font-bold text-[#0F172A]">
                        Does This Apply to Us?
                      </h3>
                      <span
                        className={`text-xs font-bold ${
                          detail.regulation.applicability_status === 'Applicable'
                            ? 'text-emerald-700'
                            : 'text-[#64748B]'
                        }`}
                      >
                        {detail.regulation.applicability_status.toUpperCase()} —{' '}
                        {detail.regulation.applicability_confidence.toUpperCase()} CONFIDENCE
                      </span>
                    </div>

                    {detail.applicability ? (
                      <>
                        <p className="text-sm text-[#334155] leading-relaxed mb-4">
                          {detail.applicability.summary}
                        </p>
                        <div className="space-y-2.5">
                          {detail.applicability.profileReasons.map((reason, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2.5 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3"
                            >
                              {reason.matched ? (
                                <Check size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                              ) : (
                                <X size={14} className="text-slate-500 shrink-0 mt-0.5" />
                              )}
                              <div>
                                <div className="font-semibold text-[#0F172A]">{reason.fact}</div>
                                <div className="text-[#64748B] mt-0.5">{reason.explanation}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="text-xs text-[#64748B]">
                        Run AI Applicability Analysis to evaluate this directive against your Company Profile.
                      </p>
                    )}
                  </div>

                  <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="font-display text-sm font-bold text-[#0F172A]">
                          What Is Affected? (Impact Mapping)
                        </h3>
                        <div className="text-xs text-[#64748B] mt-0.5 tabular-nums">
                          {detail.impactedPolicies.length} policies affected ·{' '}
                          {detail.impactedControls.length} controls affected ·{' '}
                          {detail.impactedSystems.length} systems affected ·{' '}
                          {detail.actions.length} actions required
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={aiBusy !== null}
                        onClick={handleGenerateActionPlan}
                        className="px-3.5 py-2 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <Sparkles size={13} />
                        <span>
                          {aiBusy === 'action-plan'
                            ? 'Generating Plan...'
                            : 'Generate Additional AI Actions'}
                        </span>
                      </button>
                    </div>

                    {detail.impactedPolicies.length > 0 && (
                      <div className="pt-4 border-t border-[#E2E8F0] space-y-4">
                        <h4 className="font-display text-xs font-bold text-[#0F172A] flex items-center gap-1.5">
                          <ShieldAlert size={14} className="text-amber-600" />
                          Recommended Policy Updates (Human Approval Required)
                        </h4>

                        {detail.impactedPolicies.map((pol) => (
                          <div
                            key={pol.id}
                            className="border border-[#E2E8F0] rounded-lg p-4 bg-[#F8FAFC]"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                              <div>
                                <div className="text-sm font-semibold text-[#0F172A]">{pol.title}</div>
                                <div className="text-xs text-[#64748B]">
                                  {pol.version} · Status:{' '}
                                  <span className="font-semibold text-[#0F172A]">{pol.status}</span>
                                </div>
                              </div>

                              {pol.status === 'Pending Approval' && (
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    disabled={policyBusyId === pol.id}
                                    onClick={() => handlePolicyDecision(pol.id, 'Approve')}
                                    className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                                  >
                                    Approve Update
                                  </button>
                                  <button
                                    type="button"
                                    disabled={policyBusyId === pol.id}
                                    onClick={() => handlePolicyDecision(pol.id, 'Request Changes')}
                                    className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white hover:bg-slate-50 text-[#0F172A] text-xs font-semibold cursor-pointer"
                                  >
                                    Request Changes
                                  </button>
                                  <button
                                    type="button"
                                    disabled={policyBusyId === pol.id}
                                    onClick={() => handlePolicyDecision(pol.id, 'Reject')}
                                    className="px-3 py-1.5 rounded-md border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold cursor-pointer"
                                  >
                                    Reject
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              <div className="bg-white border border-[#E2E8F0] rounded-md p-3">
                                <div className="font-semibold text-[#64748B] mb-1">Current Version</div>
                                <pre className="whitespace-pre-wrap font-sans text-[#475569] leading-relaxed">
                                  {pol.current_text}
                                </pre>
                              </div>
                              <div className="bg-white border border-emerald-200 rounded-md p-3">
                                <div className="font-semibold text-emerald-700 mb-1">
                                  Proposed Version
                                </div>
                                <pre className="whitespace-pre-wrap font-sans text-[#0F172A] leading-relaxed">
                                  {pol.proposed_text}
                                </pre>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-display text-xs font-bold text-[#0F172A]">
                          Generated Action Plan ({detail.actions.length})
                        </h4>
                        <button
                          type="button"
                          onClick={() => onNavigate('remediation')}
                          className="text-xs font-semibold text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>Go to Remediation Center</span>
                          <ArrowRight size={13} />
                        </button>
                      </div>

                      <div className="space-y-2.5">
                        {detail.actions.map((act) => (
                          <div
                            key={act.id}
                            className="border border-[#E2E8F0] rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div>
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono font-bold text-[#2563EB]">{act.code}</span>
                                <span className="font-semibold text-[#0F172A]">{act.title}</span>
                              </div>
                              <div className="text-xs text-[#64748B] mt-1">
                                Owner: {act.owner_name} ({act.owner_department}) · Deadline:{' '}
                                <span className="font-mono">{act.deadline}</span> · Priority: {act.priority}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs font-semibold text-[#0F172A]">{act.status}</span>
                              <button
                                type="button"
                                onClick={() => onNavigate('evidence', act.id)}
                                className="px-2.5 py-1.5 rounded-md border border-[#CBD5E1] text-xs font-semibold hover:bg-[#F8FAFC] cursor-pointer"
                              >
                                Evidence
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
