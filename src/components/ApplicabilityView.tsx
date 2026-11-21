import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  History,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../api';
import type {
  ApplicabilityDecision,
  ApplicabilityDetailResponse,
  ApplicabilityQueueItem,
  ApplicabilitySummaryPayload,
  NavView,
} from '../types';

interface ApplicabilityViewProps {
  selectedObligationId: string | null;
  onSelectObligation: (id: string | null) => void;
  onNavigate: (view: NavView, itemId?: string) => void;
  onDataChanged: () => void;
}

const DECISION_META: Record<
  ApplicabilityDecision,
  { label: string; bg: string; text: string; border: string }
> = {
  APPLIES: {
    label: 'Applies',
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
  },
  DOES_NOT_APPLY: {
    label: 'Does Not Apply',
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
  },
  POTENTIALLY_APPLIES: {
    label: 'Potentially Applies',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
  },
  INSUFFICIENT_INFORMATION: {
    label: 'Insufficient Info',
    bg: 'bg-orange-50',
    text: 'text-orange-800',
    border: 'border-orange-200',
  },
  REQUIRES_REVIEW: {
    label: 'Requires Review',
    bg: 'bg-blue-50',
    text: 'text-[#2563EB]',
    border: 'border-blue-200',
  },
};

export const DecisionBadge: React.FC<{ decision: ApplicabilityDecision }> = ({ decision }) => {
  const m = DECISION_META[decision] || DECISION_META.REQUIRES_REVIEW;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${m.bg} ${m.text} ${m.border}`}
    >
      {m.label}
    </span>
  );
};

export const ApplicabilityView: React.FC<ApplicabilityViewProps> = ({
  selectedObligationId,
  onSelectObligation,
  onNavigate,
  onDataChanged,
}) => {
  const [summary, setSummary] = useState<ApplicabilitySummaryPayload | null>(null);
  const [items, setItems] = useState<ApplicabilityQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);

  const [decisionFilter, setDecisionFilter] = useState<string>('');
  const [jurisdictionFilter, setJurisdictionFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [detail, setDetail] = useState<ApplicabilityDetailResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [runningAi, setRunningAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [reviewComment, setReviewComment] = useState('');
  const [overrideDecision, setOverrideDecision] = useState<ApplicabilityDecision>('APPLIES');
  const [savingReview, setSavingReview] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const [showRemForm, setShowRemForm] = useState(false);
  const [remTitle, setRemTitle] = useState('');
  const [remDepartment, setRemDepartment] = useState('Compliance');
  const [remPriority, setRemPriority] = useState('HIGH');
  const [creatingRem, setCreatingRem] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (decisionFilter) params.set('decision', decisionFilter);
      if (jurisdictionFilter) params.set('jurisdiction', jurisdictionFilter);
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      const res = await apiFetch<{
        summary: ApplicabilitySummaryPayload;
        items: ApplicabilityQueueItem[];
      }>(`/api/applicability?${params.toString()}`);
      setSummary(res.summary);
      setItems(res.items);
    } finally {
      setLoading(false);
    }
  }, [decisionFilter, jurisdictionFilter, searchQuery]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const loadDetail = useCallback(async (obligationId: string) => {
    setLoadingDetail(true);
    setAiError(null);
    try {
      const res = await apiFetch<ApplicabilityDetailResponse>(
        `/api/applicability/${encodeURIComponent(obligationId)}`
      );
      setDetail(res);
      if (res.latestAssessment) {
        setOverrideDecision(res.latestAssessment.effective_decision);
      }
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (selectedObligationId) {
      loadDetail(selectedObligationId);
    } else {
      setDetail(null);
    }
  }, [selectedObligationId, loadDetail]);

  const handleRecalculateAll = async () => {
    setRecalculating(true);
    setActionMsg(null);
    try {
      const res = await apiFetch<{ evaluatedCount: number }>('/api/applicability/recalculate', {
        method: 'POST',
        body: JSON.stringify({ useAi: false }),
      });
      setActionMsg(`Evaluated ${res.evaluatedCount} regulatory obligations against latest company profile.`);
      await loadQueue();
      if (selectedObligationId) await loadDetail(selectedObligationId);
      onDataChanged();
    } finally {
      setRecalculating(false);
    }
  };

  const handleAnalyzeObligation = async (useAi: boolean) => {
    if (!selectedObligationId) return;
    setRunningAi(true);
    setAiError(null);
    setActionMsg(null);
    try {
      await apiFetch(`/api/applicability/${encodeURIComponent(selectedObligationId)}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ useAi }),
      });
      await Promise.all([loadDetail(selectedObligationId), loadQueue()]);
      onDataChanged();
      setActionMsg(
        useAi
          ? 'Live AI applicability evaluation completed and recorded in immutable history.'
          : 'Deterministic applicability rules re-evaluated against current profile.'
      );
    } catch (err: any) {
      setAiError(err?.message || 'Unable to run applicability evaluation.');
    } finally {
      setRunningAi(false);
    }
  };

  const handleReviewAction = async (
    action: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFO' | 'OVERRIDE' | 'COMMENT'
  ) => {
    if (!selectedObligationId) return;
    setSavingReview(true);
    setActionMsg(null);
    try {
      await apiFetch(`/api/applicability/${encodeURIComponent(selectedObligationId)}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          overrideDecision: action === 'OVERRIDE' ? overrideDecision : undefined,
          comment: reviewComment.trim() || undefined,
        }),
      });
      setReviewComment('');
      await Promise.all([loadDetail(selectedObligationId), loadQueue()]);
      onDataChanged();
      setActionMsg(`Human review action "${action}" recorded (original engine decision preserved).`);
    } catch (err: any) {
      setAiError(err?.message || 'Unable to record review decision.');
    } finally {
      setSavingReview(false);
    }
  };

  const handleCreateRemediation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !selectedObligationId) return;
    setCreatingRem(true);
    setAiError(null);
    setActionMsg(null);
    try {
      const created = await apiFetch<{ id: string; code: string }>('/api/remediation', {
        method: 'POST',
        body: JSON.stringify({
          obligationId: selectedObligationId,
          title: remTitle.trim() || detail.obligation.title,
          description: detail.obligation.description,
          requiredChange: detail.obligation.required_action,
          ownerDepartment: remDepartment,
          priority: remPriority,
          sourceCitation: detail.obligation.source_reference,
          requiredEvidence: detail.obligation.evidenceRequired,
        }),
      });
      setShowRemForm(false);
      setRemTitle('');
      await loadDetail(selectedObligationId);
      onDataChanged();
      setActionMsg(`Created remediation action ${created.code} linked to this obligation.`);
    } catch (err: any) {
      setAiError(err?.message || 'Unable to create remediation action.');
    } finally {
      setCreatingRem(false);
    }
  };

  // --- DEDICATED OBLIGATION APPLICABILITY DETAIL VIEW ---
  if (selectedObligationId) {
    if (loadingDetail || !detail) {
      return <div className="h-96 bg-white border border-[#E2E8F0] rounded-xl animate-pulse" />;
    }

    const { obligation, regulation, companyContext, boundedExcerpts, latestAssessment, assessmentHistory } = detail;
    const effectiveDecision: ApplicabilityDecision = latestAssessment
      ? latestAssessment.effective_decision
      : 'REQUIRES_REVIEW';

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              onSelectObligation(null);
              setActionMsg(null);
              setAiError(null);
            }}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#475569] hover:text-[#0F172A] cursor-pointer"
          >
            <ArrowLeft size={14} />
            <span>Back to Applicability Queue</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={runningAi}
              onClick={() => handleAnalyzeObligation(false)}
              className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw size={13} className={runningAi ? 'animate-spin' : ''} />
              <span>Re-run Rules</span>
            </button>
            <button
              type="button"
              disabled={runningAi}
              onClick={() => handleAnalyzeObligation(true)}
              className="px-3.5 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles size={13} />
              <span>{runningAi ? 'Analyzing...' : 'Run Live AI Applicability Analysis'}</span>
            </button>
          </div>
        </div>

        {actionMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
            {actionMsg}
          </div>
        )}
        {aiError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-800">
            {aiError}
          </div>
        )}

        {/* Top Summary: REGULATION + OBLIGATION + APPLICABILITY */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 space-y-6">
            {/* REGULATION & OBLIGATION */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-[#E2E8F0]">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Regulation
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                    <span className="font-mono font-bold text-[#0F172A]">{regulation.regulatory_identifier}</span>
                    <span>·</span>
                    <span className="font-semibold text-[#334155]">{regulation.regulator}</span>
                    <span>·</span>
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#334155] font-medium">
                      {regulation.jurisdiction}
                      {regulation.state_province ? ` (${regulation.state_province})` : ''}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-mono font-semibold">
                      v{regulation.version_number}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[#0F172A] mt-1">{regulation.title}</div>
                </div>
                <a
                  href={regulation.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-semibold text-[#2563EB] hover:underline flex items-center gap-1"
                >
                  <span>Source</span>
                  <ExternalLink size={12} />
                </a>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Obligation
                </div>
                <h1 className="font-display text-lg font-bold text-[#0F172A] mt-1">
                  {obligation.title}
                </h1>
                <p className="text-xs text-[#475569] mt-1.5 leading-relaxed">{obligation.description}</p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3.5">
                  <div>
                    <div className="text-[#64748B]">Required Action</div>
                    <div className="font-medium text-[#0F172A] mt-0.5">{obligation.required_action}</div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Deadline & Frequency</div>
                    <div className="font-medium text-[#0F172A] mt-0.5">
                      {obligation.deadline || 'Immediate'} · {obligation.frequency || 'Ongoing'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Source Reference</div>
                    <div className="font-mono font-semibold text-[#0F172A] mt-0.5">
                      {obligation.source_reference}
                    </div>
                  </div>
                </div>
              </div>

              {/* Structured Applicability Conditions */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mb-2">
                  Structured Applicability Conditions
                </div>
                <div className="border border-[#E2E8F0] rounded-lg overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[#F8FAFC] text-[#64748B] border-b border-[#E2E8F0]">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Condition</th>
                        <th className="px-3 py-2 font-semibold">Rule</th>
                        <th className="px-3 py-2 font-semibold">Profile Field</th>
                        <th className="px-3 py-2 font-semibold">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {obligation.structuredConditions.map((c) => (
                        <tr key={c.id}>
                          <td className="px-3 py-2 font-medium text-[#0F172A]">{c.description}</td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[#334155]">
                            {c.operator} {JSON.stringify(c.expected_value)}
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-[#64748B]">{c.field_path}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                c.is_exclusion
                                  ? 'bg-red-50 text-red-700'
                                  : 'bg-slate-100 text-[#334155]'
                              }`}
                            >
                              {c.is_exclusion ? 'EXCLUSION' : c.condition_type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* APPLICABILITY & EVIDENCE (STRICT SEPARATION: AUTHORITATIVE SOURCE TEXT VS AI INTERPRETATION) */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-[#E2E8F0]">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Applicability Decision
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                    <DecisionBadge decision={effectiveDecision} />
                    {latestAssessment && (
                      <>
                        <span className="px-2 py-0.5 rounded-md border border-[#E2E8F0] bg-[#F8FAFC] text-[11px] font-semibold text-[#0F172A]">
                          {latestAssessment.confidence_level} confidence
                        </span>
                        <span className="text-[11px] font-mono text-[#64748B]">
                          Method: {latestAssessment.evaluation_method}
                        </span>
                        {latestAssessment.is_stale && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-800">
                            Stale (Profile Updated)
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-[#64748B] mt-1.5">
                    Confidence reflects the completeness and consistency of available evidence and rules — not legal certification.
                  </p>
                </div>

                {latestAssessment?.human_override_decision && (
                  <div className="border border-blue-200 bg-blue-50/60 rounded-lg px-3 py-2 text-xs">
                    <div className="font-semibold text-[#0F172A]">Human Override Active</div>
                    <div className="text-[#475569] mt-0.5">
                      Original Engine Output: <span className="font-mono font-semibold">{latestAssessment.decision}</span> → Override:{' '}
                      <span className="font-mono font-bold text-[#2563EB]">
                        {latestAssessment.human_override_decision}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Reasoning Summary */}
              {latestAssessment && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4">
                    <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[#475569] mb-1">
                      <span>
                        {latestAssessment.model_name
                          ? `AI Interpretation (${latestAssessment.model_name})`
                          : 'Deterministic Rule Engine Interpretation'}
                      </span>
                      <span>Evaluated on Profile v{latestAssessment.evaluated_profile_version}</span>
                    </div>
                    <p className="text-xs text-[#0F172A] leading-relaxed">
                      {latestAssessment.reasoning_summary}
                    </p>
                  </div>

                  {/* Conflicting Conditions Alert */}
                  {latestAssessment.conflicting_conditions.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-1">
                      <div className="font-bold flex items-center gap-1.5">
                        <ShieldAlert size={14} />
                        <span>Conflicting Rule & AI Interpretation Flagged</span>
                      </div>
                      {latestAssessment.conflicting_conditions.map((c, idx) => (
                        <div key={idx}>{c}</div>
                      ))}
                    </div>
                  )}

                  {/* Missing Information -> Feedback Loop */}
                  {latestAssessment.missing_information.length > 0 && (
                    <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs font-bold text-orange-900 flex items-center gap-1.5">
                          <HelpCircle size={14} />
                          <span>Missing Information Required to Determine Applicability</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate('company-profile')}
                          className="px-3 py-1.5 rounded-md bg-orange-700 hover:bg-orange-800 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          <Building2 size={12} />
                          <span>Update Company Profile</span>
                        </button>
                      </div>
                      <ul className="list-disc pl-5 text-xs text-orange-900 space-y-1">
                        {latestAssessment.missing_information.map((m, idx) => (
                          <li key={idx}>{m}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Matched & Failed Condition Checks */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
                        Matched Conditions ({latestAssessment.matched_conditions.length})
                      </div>
                      {latestAssessment.matched_conditions.length === 0 ? (
                        <div className="text-xs text-[#64748B]">No conditions matched.</div>
                      ) : (
                        <div className="space-y-2">
                          {latestAssessment.matched_conditions.map((mc, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-[#0F172A]">
                              <CheckCircle2 size={14} className="text-emerald-600 shrink-0 mt-0.5" />
                              <span>{mc.explanation}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-red-700">
                        Non-Matching / Excluded ({latestAssessment.failed_conditions.length})
                      </div>
                      {latestAssessment.failed_conditions.length === 0 ? (
                        <div className="text-xs text-[#64748B]">No failing or exclusion conditions triggered.</div>
                      ) : (
                        <div className="space-y-2">
                          {latestAssessment.failed_conditions.map((fc, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs text-[#0F172A]">
                              <XCircle size={14} className="text-red-600 shrink-0 mt-0.5" />
                              <span>{fc.explanation}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Authoritative Source Text (Strict Separation from AI Interpretation) */}
              <div className="space-y-2.5 pt-2 border-t border-[#E2E8F0]">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#0F172A]">
                  Authoritative Source Text &amp; Bounded Retrieval Excerpts
                </div>
                {boundedExcerpts.map((ex, idx) => (
                  <div key={idx} className="border border-[#E2E8F0] rounded-lg p-3.5 bg-white text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-[#0F172A]">
                        {ex.title} · {ex.section}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 font-mono text-[#475569]">
                        {ex.source_type === 'REGULATION_SECTION' ? 'SOURCE TEXT' : 'INTERNAL DOC'} · {ex.version}
                      </span>
                    </div>
                    <p className="text-[#334155] leading-relaxed whitespace-pre-line">{ex.excerpt}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* DOWNSTREAM REMEDIATION & EVIDENCE BRIDGE */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Internal Impact &amp; Execution
                  </div>
                  <h2 className="font-display text-sm font-bold text-[#0F172A] mt-0.5">
                    Downstream Remediation Actions &amp; Evidence ({detail.linkedRemediations?.length || 0})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!showRemForm) {
                      setRemTitle(obligation.title);
                    }
                    setShowRemForm(!showRemForm);
                  }}
                  className="px-3.5 py-2 rounded-lg bg-[#0F1D3D] hover:bg-[#182952] text-white text-xs font-semibold cursor-pointer"
                >
                  {showRemForm ? 'Cancel' : 'Create Remediation Action'}
                </button>
              </div>

              {showRemForm && (
                <form
                  onSubmit={handleCreateRemediation}
                  className="border border-[#CBD5E1] bg-[#F8FAFC] rounded-lg p-4 space-y-3 text-xs"
                >
                  <div>
                    <label className="block font-medium text-[#334155] mb-1">Action Title</label>
                    <input
                      required
                      value={remTitle}
                      onChange={(e) => setRemTitle(e.target.value)}
                      className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-[#334155] mb-1">Owner Department</label>
                      <select
                        value={remDepartment}
                        onChange={(e) => setRemDepartment(e.target.value)}
                        className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
                      >
                        <option value="Compliance">Compliance</option>
                        <option value="Engineering">Engineering</option>
                        <option value="Security">Security</option>
                        <option value="Operations">Operations</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-[#334155] mb-1">Priority</label>
                      <select
                        value={remPriority}
                        onChange={(e) => setRemPriority(e.target.value)}
                        className="w-full rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs"
                      >
                        <option value="CRITICAL">CRITICAL</option>
                        <option value="HIGH">HIGH</option>
                        <option value="MEDIUM">MEDIUM</option>
                        <option value="LOW">LOW</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={creatingRem}
                      className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
                    >
                      {creatingRem ? 'Creating Action...' : 'Save Remediation Action'}
                    </button>
                  </div>
                </form>
              )}

              {!detail.linkedRemediations || detail.linkedRemediations.length === 0 ? (
                <p className="text-xs text-[#64748B]">
                  No remediation actions created for this obligation yet. Create one to assign ownership, upload evidence, and complete human verification.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {detail.linkedRemediations.map((rem) => (
                    <div
                      key={rem.id}
                      className="border border-[#E2E8F0] rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs bg-[#F8FAFC]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-[#2563EB]">{rem.code}</span>
                          <span className="px-1.5 py-0.5 rounded bg-white border border-[#E2E8F0] font-semibold text-[#0F172A]">
                            {rem.status}
                          </span>
                          <span className="text-[#64748B]">{rem.owner_department}</span>
                          <span className="font-mono text-[#64748B]">
                            {rem.evidence_count || 0} evidence ({rem.verified_evidence_count || 0} verified)
                          </span>
                        </div>
                        <div className="font-semibold text-[#0F172A] mt-1">{rem.title}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onNavigate('remediation', rem.id)}
                          className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] font-semibold text-[#0F172A] cursor-pointer"
                        >
                          Open Remediation
                        </button>
                        <button
                          type="button"
                          onClick={() => onNavigate('evidence', rem.id)}
                          className="px-3 py-1.5 rounded-md bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold cursor-pointer"
                        >
                          Upload Evidence
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Company Context + Human Review + Assessment Decision History */}
          <div className="xl:col-span-4 space-y-6">
            {/* COMPANY CONTEXT */}
            {companyContext && (
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                    Company Context
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[#2563EB]">
                    Profile v{companyContext.profileVersion} · {companyContext.completenessPct}%
                  </span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Legal Entity</span>
                    <span className="font-semibold text-[#0F172A] text-right">
                      {companyContext.structuredProfile.identity.legal_name}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Company Type</span>
                    <span className="font-medium text-[#0F172A] text-right">
                      {companyContext.structuredProfile.business.company_type}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Industry</span>
                    <span className="font-medium text-[#0F172A] text-right">
                      {companyContext.structuredProfile.business.industry}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Countries</span>
                    <span className="font-medium text-[#0F172A] text-right">
                      {companyContext.structuredProfile.geography.countries_of_operation.join(', ') || 'UNKNOWN'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Annual Revenue</span>
                    <span className="font-mono font-medium text-[#0F172A] text-right">
                      {typeof companyContext.structuredProfile.scale.annual_revenue === 'number'
                        ? `${companyContext.structuredProfile.scale.annual_revenue_currency} ${companyContext.structuredProfile.scale.annual_revenue.toLocaleString()}`
                        : companyContext.structuredProfile.scale.annual_revenue}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Total Assets</span>
                    <span className="font-mono font-medium text-[#0F172A] text-right">
                      {typeof companyContext.structuredProfile.scale.assets === 'number'
                        ? `${companyContext.structuredProfile.scale.annual_revenue_currency} ${companyContext.structuredProfile.scale.assets.toLocaleString()}`
                        : companyContext.structuredProfile.scale.assets}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-[#64748B]">Licenses</span>
                    <span className="font-medium text-[#0F172A] text-right">
                      {companyContext.structuredProfile.regulatory.licenses.join(', ') || 'None / NOT_PROVIDED'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate('company-profile')}
                  className="w-full mt-2 px-3 py-2 rounded-lg border border-[#CBD5E1] hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] cursor-pointer"
                >
                  Edit Company Profile
                </button>
              </div>
            )}

            {/* HUMAN REVIEW & OVERRIDE WORKFLOW */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                  Human Review &amp; Sign-Off
                </div>
                {latestAssessment && (
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-[11px] font-mono font-semibold text-[#334155]">
                    {latestAssessment.human_review_status}
                  </span>
                )}
              </div>

              {latestAssessment?.reviewer_name && (
                <div className="text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3 space-y-1">
                  <div className="font-semibold text-[#0F172A]">
                    Reviewed by {latestAssessment.reviewer_name}
                  </div>
                  {latestAssessment.review_comment && (
                    <div className="text-[#475569]">{latestAssessment.review_comment}</div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Reviewer Rationale / Note
                </label>
                <textarea
                  rows={2}
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Document rationale for approval, override, or missing info request..."
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={savingReview || !latestAssessment}
                  onClick={() => handleReviewAction('APPROVE')}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={savingReview || !latestAssessment}
                  onClick={() => handleReviewAction('REJECT')}
                  className="px-3 py-2 rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-semibold cursor-pointer"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={savingReview || !latestAssessment}
                  onClick={() => handleReviewAction('REQUEST_MORE_INFO')}
                  className="col-span-2 px-3 py-2 rounded-lg border border-orange-200 bg-orange-50 hover:bg-orange-100 text-orange-800 text-xs font-semibold cursor-pointer"
                >
                  Request More Info
                </button>
              </div>

              <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
                <label className="block text-xs font-medium text-[#334155]">
                  Manual Override (Preserves Original AI/Engine Decision)
                </label>
                <div className="flex gap-2">
                  <select
                    value={overrideDecision}
                    onChange={(e) => setOverrideDecision(e.target.value as ApplicabilityDecision)}
                    className="flex-1 rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs"
                  >
                    <option value="APPLIES">APPLIES</option>
                    <option value="DOES_NOT_APPLY">DOES_NOT_APPLY</option>
                    <option value="POTENTIALLY_APPLIES">POTENTIALLY_APPLIES</option>
                    <option value="INSUFFICIENT_INFORMATION">INSUFFICIENT_INFORMATION</option>
                    <option value="REQUIRES_REVIEW">REQUIRES_REVIEW</option>
                  </select>
                  <button
                    type="button"
                    disabled={savingReview || !latestAssessment}
                    onClick={() => handleReviewAction('OVERRIDE')}
                    className="px-3 py-1.5 rounded-lg bg-[#0F1D3D] hover:bg-[#182952] text-white text-xs font-semibold cursor-pointer"
                  >
                    Override
                  </button>
                </div>
              </div>
            </div>

            {/* IMMUTABLE DECISION HISTORY */}
            <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-[#64748B]">
                <History size={13} />
                <span>Immutable Decision History ({assessmentHistory.length})</span>
              </div>
              <div className="space-y-2.5 max-h-72 overflow-y-auto">
                {assessmentHistory.map((h) => (
                  <div
                    key={h.id}
                    className="border border-[#E2E8F0] rounded-lg p-3 text-xs space-y-1 bg-[#F8FAFC]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <DecisionBadge decision={h.effective_decision} />
                      <span className="font-mono text-[10px] text-[#64748B]">
                        Profile v{h.evaluated_profile_version}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#334155]">
                      {h.evaluation_method} · {h.confidence_level} confidence
                      {h.is_stale ? ' · Superseded/Stale' : ''}
                    </div>
                    <div className="text-[10px] font-mono text-[#64748B]">
                      {new Date(h.evaluated_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- APPLICABILITY QUEUE LIST VIEW ---
  const jurisdictions = Array.from(new Set(items.map((i) => i.obligation.jurisdiction))).sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">
            Obligation Applicability Engine
          </h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Evaluates which regulatory obligations actually apply to your organization using deterministic rules, bounded regulatory citations, and structured profile facts.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('company-profile')}
            className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white hover:bg-[#F8FAFC] text-xs font-semibold text-[#0F172A] flex items-center gap-1.5 cursor-pointer"
          >
            <Building2 size={14} />
            <span>Profile v{summary?.profileVersion || 1} ({summary?.profileCompletenessPct || 0}%)</span>
          </button>
          <button
            type="button"
            disabled={recalculating}
            onClick={handleRecalculateAll}
            className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={14} className={recalculating ? 'animate-spin' : ''} />
            <span>{recalculating ? 'Evaluating...' : 'Recalculate Applicability'}</span>
          </button>
        </div>
      </div>

      {actionMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {actionMsg}
        </div>
      )}

      {/* 6 Applicability Metrics */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Applicable Obligations', val: summary.applicable, color: 'text-emerald-700', filter: 'APPLIES' },
            { label: 'Potentially Applicable', val: summary.potentiallyApplicable, color: 'text-amber-700', filter: 'POTENTIALLY_APPLIES' },
            { label: 'Requires Review', val: summary.requiresReview, color: 'text-[#2563EB]', filter: 'REQUIRES_REVIEW' },
            { label: 'Insufficient Information', val: summary.insufficientInformation, color: 'text-orange-700', filter: 'INSUFFICIENT_INFORMATION' },
            { label: 'Not Applicable', val: summary.notApplicable, color: 'text-slate-600', filter: 'DOES_NOT_APPLY' },
            { label: 'New Applicable', val: summary.newApplicableObligations, color: 'text-[#2563EB]', filter: 'APPLIES' },
          ].map((card) => (
            <button
              key={card.label}
              type="button"
              onClick={() => setDecisionFilter(decisionFilter === card.filter ? '' : card.filter)}
              className={`text-left bg-white border rounded-xl p-4 transition-colors cursor-pointer ${
                decisionFilter === card.filter ? 'border-[#2563EB] ring-2 ring-[#2563EB]/15' : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
              }`}
            >
              <div className="text-[11px] font-medium text-[#64748B] leading-tight">{card.label}</div>
              <div className={`font-display text-2xl font-bold mt-1.5 tabular-nums ${card.color}`}>
                {card.val}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search obligation, regulator, citation, or reason..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#F8FAFC]"
          />
        </div>
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
          className="rounded-lg border border-[#CBD5E1] px-3 py-1.5 text-xs"
        >
          <option value="">All Decisions</option>
          <option value="APPLIES">Applies</option>
          <option value="POTENTIALLY_APPLIES">Potentially Applies</option>
          <option value="INSUFFICIENT_INFORMATION">Insufficient Info</option>
          <option value="REQUIRES_REVIEW">Requires Review</option>
          <option value="DOES_NOT_APPLY">Does Not Apply</option>
        </select>
        <select
          value={jurisdictionFilter}
          onChange={(e) => setJurisdictionFilter(e.target.value)}
          className="rounded-lg border border-[#CBD5E1] px-3 py-1.5 text-xs"
        >
          <option value="">All Jurisdictions</option>
          {jurisdictions.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
      </div>

      {/* Applicability Table */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-xs text-[#64748B]">Loading applicability assessments...</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#64748B]">
            No obligations match the current filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Obligation</th>
                  <th className="px-4 py-3 font-semibold">Regulation</th>
                  <th className="px-4 py-3 font-semibold">Decision</th>
                  <th className="px-4 py-3 font-semibold">Confidence</th>
                  <th className="px-4 py-3 font-semibold">Reason</th>
                  <th className="px-4 py-3 font-semibold">Review</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {items.map((item) => {
                  const a = item.assessment;
                  return (
                    <tr key={item.obligation.id} className="hover:bg-[#F8FAFC]">
                      <td className="px-4 py-3 max-w-xs">
                        <div className="font-semibold text-[#0F172A]">{item.obligation.title}</div>
                        <div className="text-[11px] text-[#64748B] mt-0.5">
                          {item.obligation.obligation_type} · {item.obligation.source_reference}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-mono font-bold text-[#0F172A]">
                          {item.obligation.regulatory_identifier}
                        </div>
                        <div className="text-[11px] text-[#64748B]">
                          {item.obligation.regulator} · {item.obligation.jurisdiction}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <DecisionBadge decision={item.effective_decision} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-[#334155]">
                        {a ? `${a.confidence_level} confidence` : 'Unassessed'}
                      </td>
                      <td className="px-4 py-3 max-w-sm text-[#475569]">
                        <div className="line-clamp-2">
                          {a?.reasoning_summary || 'Run applicability evaluation to generate grounded reasoning.'}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-[11px] font-mono text-[#334155]">
                          {a?.human_review_status || 'PENDING_REVIEW'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => onSelectObligation(item.obligation.id)}
                          className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] font-semibold text-[#0F172A] cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
