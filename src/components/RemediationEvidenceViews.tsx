import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  FileCheck2,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../api';
import type { EvidenceItem, NavView, PolicyItem, RemediationItem } from '../types';

interface RemediationCenterProps {
  initialActionId?: string | null;
  onNavigate: (view: NavView, itemId?: string) => void;
  onDataChanged: () => void;
}

export const RemediationCenterView: React.FC<RemediationCenterProps> = ({
  initialActionId,
  onNavigate,
  onDataChanged,
}) => {
  const [actions, setActions] = useState<RemediationItem[]>([]);
  const [policies, setPolicies] = useState<PolicyItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [selectedAction, setSelectedAction] = useState<RemediationItem | null>(null);
  const [commentText, setCommentText] = useState('');
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [remRes, polRes] = await Promise.all([
        apiFetch<RemediationItem[]>('/api/remediation'),
        apiFetch<PolicyItem[]>('/api/policies'),
      ]);
      setActions(remRes);
      setPolicies(polRes);
      if (initialActionId) {
        const target = remRes.find((r) => r.id === initialActionId);
        if (target) {
          setSelectedAction(target);
          return;
        }
      }
      if (selectedAction) {
        const refreshed = remRes.find((r) => r.id === selectedAction.id) || null;
        setSelectedAction(refreshed);
      } else if (remRes.length > 0) {
        setSelectedAction(remRes[0]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [initialActionId]);

  const departments = Array.from(new Set(actions.map((a) => a.owner_department).filter(Boolean))).sort();

  const filtered = actions.filter((a) => {
    if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
    if (deptFilter !== 'ALL' && a.owner_department !== deptFilter) return false;
    return true;
  });

  const handleStatusChange = async (actionId: string, status: string) => {
    await apiFetch(`/api/remediation/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    setFeedback(`Action status updated to "${status}".`);
    await loadData();
    onDataChanged();
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAction || !commentText.trim()) return;
    await apiFetch(`/api/remediation/${selectedAction.id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body: commentText }),
    });
    setCommentText('');
    await loadData();
  };

  const handlePolicyDecision = async (
    policyId: string,
    decision: 'Approve' | 'Reject' | 'Request Changes'
  ) => {
    await apiFetch(`/api/policies/${policyId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    });
    setFeedback(`Policy update decision recorded: ${decision}.`);
    await loadData();
    onDataChanged();
  };

  const linkedPolicy = selectedAction?.policy_id
    ? policies.find((p) => p.id === selectedAction.policy_id)
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-bold text-[#0F172A]">Remediation Center</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Track action plans from Not Started → In Progress → Implemented → Verified.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="Not Started">Not Started</option>
            <option value="In Progress">In Progress</option>
            <option value="Ready for Review">Ready for Review</option>
            <option value="Implemented">Implemented</option>
            <option value="Verified">Verified</option>
          </select>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="rounded-lg border border-[#CBD5E1] bg-white px-3 py-2 text-xs font-medium"
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {feedback && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          {loading ? (
            <div className="h-72 animate-pulse" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC] text-xs font-semibold text-[#475569]">
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-3">Owner</th>
                    <th className="py-3 px-3">Priority</th>
                    <th className="py-3 px-3">Deadline</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {filtered.map((act) => {
                    const selected = selectedAction?.id === act.id;
                    return (
                      <tr
                        key={act.id}
                        onClick={() => setSelectedAction(act)}
                        className={`cursor-pointer transition-colors ${
                          selected ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono font-bold text-[#2563EB]">{act.code}</div>
                          <div className="font-semibold text-[#0F172A] mt-0.5">{act.title}</div>
                        </td>
                        <td className="py-3 px-3 text-[#475569]">
                          <div>{act.owner_name}</div>
                          <div className="text-[11px] text-[#64748B]">{act.owner_department}</div>
                        </td>
                        <td className="py-3 px-3 font-semibold">
                          <span
                            className={
                              act.priority === 'CRITICAL'
                                ? 'text-red-700'
                                : act.priority === 'HIGH'
                                ? 'text-amber-700'
                                : 'text-[#2563EB]'
                            }
                          >
                            {act.priority}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono tabular-nums text-[#475569]">
                          {act.deadline}
                        </td>
                        <td className="py-3 px-4 font-semibold text-[#0F172A]">{act.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Remediation Drawer */}
        <div className="xl:col-span-5 bg-white border border-[#E2E8F0] rounded-xl p-6">
          {!selectedAction ? (
            <p className="text-xs text-[#64748B]">Select a remediation action to inspect details.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-xs font-bold text-[#2563EB]">
                    {selectedAction.code} · {selectedAction.source_citation}
                  </div>
                  <h2 className="font-display text-base font-bold text-[#0F172A] mt-1">
                    {selectedAction.title}
                  </h2>
                </div>
                <select
                  value={selectedAction.status}
                  onChange={(e) => handleStatusChange(selectedAction.id, e.target.value)}
                  className="rounded-lg border border-[#CBD5E1] px-2.5 py-1.5 text-xs font-semibold text-[#0F172A]"
                >
                  {[
                    'Not Started',
                    'In Progress',
                    'Blocked',
                    'Ready for Review',
                    'Implemented',
                    'Verified',
                    'Rejected',
                  ].map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-[#475569] leading-relaxed">
                {selectedAction.description}
              </div>

              <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg p-3.5 text-xs">
                <div className="font-semibold text-[#0F172A] mb-1">Required Change</div>
                <div className="text-[#475569]">{selectedAction.required_change}</div>
              </div>

              <div>
                <div className="text-xs font-semibold text-[#0F172A] mb-1.5">
                  Evidence Required
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-[#475569]">
                  {selectedAction.requiredEvidence.map((ev, i) => (
                    <li key={i}>{ev}</li>
                  ))}
                </ul>
              </div>

              {linkedPolicy && (
                <div className="border border-[#E2E8F0] rounded-lg p-3.5 bg-[#FFFBEB]/40 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#0F172A]">
                      Linked Policy: {linkedPolicy.title}
                    </span>
                    <span className="font-semibold text-amber-800">{linkedPolicy.status}</span>
                  </div>
                  {linkedPolicy.status === 'Pending Approval' && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handlePolicyDecision(linkedPolicy.id, 'Approve')}
                        className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold cursor-pointer"
                      >
                        Approve Policy Diff
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePolicyDecision(linkedPolicy.id, 'Request Changes')}
                        className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white text-xs font-semibold cursor-pointer"
                      >
                        Request Changes
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => onNavigate('evidence', selectedAction.id)}
                  className="px-4 py-2 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload size={13} />
                  <span>Upload & Verify Evidence</span>
                </button>
              </div>

              {/* Comments */}
              <div className="pt-3 border-t border-[#E2E8F0] space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F172A]">
                  <MessageSquare size={13} />
                  <span>Activity Notes ({selectedAction.comments?.length || 0})</span>
                </div>
                <div className="space-y-2 max-h-36 overflow-y-auto">
                  {selectedAction.comments?.map((c) => (
                    <div key={c.id} className="text-xs bg-[#F8FAFC] rounded-lg p-2.5">
                      <div className="font-semibold text-[#0F172A]">{c.author_name}</div>
                      <div className="text-[#475569] mt-0.5">{c.body}</div>
                    </div>
                  ))}
                </div>
                <form onSubmit={handleAddComment} className="flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Add remediation note..."
                    className="flex-1 rounded-lg border border-[#CBD5E1] px-3 py-1.5 text-xs"
                  />
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-[#0F1D3D] text-white text-xs font-semibold cursor-pointer"
                  >
                    Post
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface EvidenceVerificationProps {
  initialRemediationId: string | null;
  onNavigate: (view: NavView, itemId?: string) => void;
  onDataChanged: () => void;
}

export const EvidenceVerificationView: React.FC<EvidenceVerificationProps> = ({
  initialRemediationId,
  onNavigate,
  onDataChanged,
}) => {
  const [evidenceList, setEvidenceList] = useState<EvidenceItem[]>([]);
  const [remediations, setRemediations] = useState<RemediationItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [remediationId, setRemediationId] = useState<string>(initialRemediationId || '');
  const [title, setTitle] = useState('');
  const [evidenceType, setEvidenceType] = useState('configuration');
  const [textProof, setTextProof] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [aiEvaluating, setAiEvaluating] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [completionCard, setCompletionCard] = useState<{
    requirementTitle: string;
    evidenceCount: number;
    approvedBy: string;
    verifiedAt: string;
  } | null>(null);

  const loadAll = async () => {
    const [evRes, remRes] = await Promise.all([
      apiFetch<EvidenceItem[]>('/api/evidence'),
      apiFetch<RemediationItem[]>('/api/remediation'),
    ]);
    setEvidenceList(evRes);
    setRemediations(remRes);
    if (!remediationId && remRes.length > 0) {
      setRemediationId(initialRemediationId || remRes[0].id);
    }
    if (!selectedId && evRes.length > 0) {
      setSelectedId(evRes[0].id);
    }
  };

  useEffect(() => {
    if (initialRemediationId) {
      setRemediationId(initialRemediationId);
    }
    loadAll();
  }, [initialRemediationId]);

  const selectedEvidence = evidenceList.find((e) => e.id === selectedId) || null;

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('remediationId', remediationId);
      fd.append('title', title);
      fd.append('evidenceType', evidenceType);
      if (file) {
        fd.append('file', file);
      } else {
        fd.append('textProof', textProof);
      }

      const created = await apiFetch<{ id: string }>('/api/evidence', {
        method: 'POST',
        body: fd,
      });
      setTitle('');
      setTextProof('');
      setFile(null);
      await loadAll();
      setSelectedId(created.id);
      onDataChanged();
    } catch (err: any) {
      setError(err?.message || 'Evidence upload failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunAiEval = async (evId: string) => {
    setError(null);
    setAiEvaluating(true);
    try {
      await apiFetch(`/api/evidence/${evId}/verify-ai`, { method: 'POST' });
      await loadAll();
      onDataChanged();
    } catch (err: any) {
      setError(err?.message || 'AI evaluation failed.');
    } finally {
      setAiEvaluating(false);
    }
  };

  const handleHumanReview = async (evId: string, decision: 'Accepted' | 'Rejected') => {
    setError(null);
    try {
      const res = await apiFetch<{
        status: string;
        requirementTitle: string;
        evidenceCount: number;
        approvedBy: string;
        verifiedAt: string;
      }>(`/api/evidence/${evId}/review`, {
        method: 'POST',
        body: JSON.stringify({
          decision,
          notes: reviewNotes || (decision === 'Accepted' ? 'Verified supporting evidence.' : 'Additional proof requested.'),
        }),
      });
      setReviewNotes('');
      await loadAll();
      onDataChanged();
      if (res.status === 'VERIFIED') {
        setCompletionCard({
          requirementTitle: res.requirementTitle,
          evidenceCount: res.evidenceCount,
          approvedBy: res.approvedBy,
          verifiedAt: res.verifiedAt,
        });
      }
    } catch (err: any) {
      setError(err?.message || 'Verification decision failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-[#0F172A]">
          Evidence & Verification (“Prove It”)
        </h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Requirement → Required Evidence → Uploaded Evidence → AI Decision Support → Human Compliance Verification.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Completion State Card (PRD Section 26 — replaces generic "Thank You") */}
      {completionCard && (
        <div className="bg-white border border-emerald-300 rounded-xl p-6 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <CheckCircle2 size={22} />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[#0F172A]">
                  Compliance Requirement Verified
                </h2>
                <p className="text-xs text-[#475569] mt-0.5">
                  The required remediation has been completed and supporting evidence has been reviewed and verified.
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 text-xs">
                  <div>
                    <div className="text-[#64748B]">Requirement</div>
                    <div className="font-semibold text-[#0F172A] mt-0.5">
                      {completionCard.requirementTitle}
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Status</div>
                    <div className="font-bold text-emerald-700 mt-0.5">VERIFIED</div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Evidence Items</div>
                    <div className="font-semibold text-[#0F172A] mt-0.5 tabular-nums">
                      {completionCard.evidenceCount} item(s)
                    </div>
                  </div>
                  <div>
                    <div className="text-[#64748B]">Approved By</div>
                    <div className="font-semibold text-[#0F172A] mt-0.5">
                      {completionCard.approvedBy} ·{' '}
                      {new Date(completionCard.verifiedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('audit-log')}
                className="px-3.5 py-2 rounded-lg bg-[#0F1D3D] text-white text-xs font-semibold cursor-pointer"
              >
                View Audit Trail
              </button>
              <button
                type="button"
                onClick={() => onNavigate('controls')}
                className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                View Related Controls
              </button>
              <button
                type="button"
                onClick={() => {
                  setCompletionCard(null);
                  onNavigate('dashboard');
                }}
                className="px-3.5 py-2 rounded-lg border border-[#CBD5E1] bg-white text-xs font-semibold text-[#0F172A] cursor-pointer"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left: Upload Evidence Form + Evidence Queue */}
        <div className="xl:col-span-5 space-y-6">
          <form
            onSubmit={handleUpload}
            className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-3.5"
          >
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Submit Compliance Evidence
            </h2>
            <div>
              <label className="block text-xs font-medium text-[#334155] mb-1">
                Linked Remediation Action
              </label>
              <select
                required
                value={remediationId}
                onChange={(e) => setRemediationId(e.target.value)}
                className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
              >
                {remediations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} — {r.title} ({r.status})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Evidence Title
                </label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="S3 Object Lock 5-Yr Config"
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Evidence Type
                </label>
                <select
                  value={evidenceType}
                  onChange={(e) => setEvidenceType(e.target.value)}
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
                >
                  <option value="configuration">Configuration</option>
                  <option value="policy">Policy</option>
                  <option value="screenshot">Screenshot</option>
                  <option value="log">System Log</option>
                  <option value="report">Audit Report</option>
                  <option value="certificate">Certificate</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#334155] mb-1">
                Upload File (PDF, JSON, TXT, CSV, PNG, JPG)
              </label>
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full text-xs text-[#475569] file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-[#CBD5E1] file:text-xs file:font-semibold file:bg-[#F8FAFC] hover:file:bg-[#F1F5F9]"
              />
            </div>
            {!file && (
              <div>
                <label className="block text-xs font-medium text-[#334155] mb-1">
                  Or Paste Configuration / Log Proof
                </label>
                <textarea
                  rows={3}
                  value={textProof}
                  onChange={(e) => setTextProof(e.target.value)}
                  placeholder='{"retentionDays": 1825, "objectLockMode": "COMPLIANCE"}'
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs font-mono"
                />
              </div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold cursor-pointer"
            >
              {submitting ? 'Uploading Evidence...' : 'Upload Evidence for Review'}
            </button>
          </form>

          <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden divide-y divide-[#E2E8F0]">
            <div className="px-5 py-3.5 bg-[#F8FAFC] text-xs font-bold text-[#0F172A]">
              Submitted Evidence ({evidenceList.length})
            </div>
            {evidenceList.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => setSelectedId(ev.id)}
                className={`w-full text-left p-4 transition-colors cursor-pointer ${
                  selectedId === ev.id ? 'bg-[#EFF6FF]' : 'hover:bg-[#F8FAFC]'
                }`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[#2563EB] font-semibold">
                    {ev.remediation_code || ev.evidence_type}
                  </span>
                  <span
                    className={`font-semibold ${
                      ev.status === 'Accepted'
                        ? 'text-emerald-700'
                        : ev.status === 'Rejected'
                        ? 'text-red-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {ev.status}
                  </span>
                </div>
                <div className="text-sm font-semibold text-[#0F172A] mt-1">{ev.title}</div>
                <div className="text-xs text-[#64748B] mt-0.5 font-mono">{ev.filename}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Evidence Verification Inspector */}
        <div className="xl:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-6">
          {!selectedEvidence ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              Select an evidence artifact to evaluate and verify.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-[#64748B]">
                    {selectedEvidence.remediation_code} · {selectedEvidence.control_code || 'Control Proof'} ·{' '}
                    {selectedEvidence.evidence_type}
                  </div>
                  <h2 className="font-display text-lg font-bold text-[#0F172A] mt-1">
                    {selectedEvidence.title}
                  </h2>
                  <div className="text-xs font-mono text-[#475569] mt-1">
                    {selectedEvidence.filename} ({selectedEvidence.size_bytes} bytes)
                  </div>
                </div>
                <button
                  type="button"
                  disabled={aiEvaluating}
                  onClick={() => handleRunAiEval(selectedEvidence.id)}
                  className="px-3.5 py-2 rounded-lg border border-[#2563EB] text-[#2563EB] hover:bg-[#EFF6FF] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles size={13} />
                  <span>
                    {aiEvaluating ? 'Evaluating...' : 'Run Gemini Evidence Assessment'}
                  </span>
                </button>
              </div>

              <div className="border border-[#E2E8F0] rounded-lg p-3.5 bg-[#F8FAFC]">
                <div className="text-xs font-semibold text-[#475569] mb-1.5">
                  Extracted Artifact Content
                </div>
                <pre className="text-xs font-mono text-[#0F172A] whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {selectedEvidence.extracted_text}
                </pre>
              </div>

              {selectedEvidence.aiAssessment && (
                <div className="border border-[#E2E8F0] rounded-lg p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-[#0F172A] flex items-center gap-1.5">
                      <FileCheck2 size={14} className="text-[#2563EB]" />
                      AI Decision Support Assessment
                    </span>
                    <span className="font-mono font-bold text-emerald-700">
                      {selectedEvidence.aiAssessment.recommendation} (
                      {selectedEvidence.aiAssessment.confidence})
                    </span>
                  </div>
                  <p className="text-xs text-[#334155] leading-relaxed">
                    {selectedEvidence.aiAssessment.summary}
                  </p>
                  {selectedEvidence.aiAssessment.matchedCriteria?.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-emerald-800 space-y-0.5">
                      {selectedEvidence.aiAssessment.matchedCriteria.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  )}
                  <div className="text-[11px] text-[#64748B] pt-1 border-t border-[#E2E8F0]">
                    {selectedEvidence.aiAssessment.disclaimer ||
                      'Decision support only — ComplianceOS verification requires human reviewer sign-off.'}
                  </div>
                </div>
              )}

              {/* Human Compliance Officer Verification Box */}
              <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold text-[#0F172A] flex items-center gap-1.5">
                    <ShieldCheck size={15} className="text-[#2563EB]" />
                    <span>Compliance Officer Verification Decision</span>
                  </h3>
                  <span className="text-xs font-semibold text-[#475569]">
                    Current Status: {selectedEvidence.status}
                  </span>
                </div>

                <textarea
                  rows={2}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="Enter reviewer verification notes..."
                  className="w-full rounded-lg border border-[#CBD5E1] px-3 py-2 text-xs"
                />

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => handleHumanReview(selectedEvidence.id, 'Accepted')}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCircle2 size={14} />
                    <span>Approve & Mark VERIFIED</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleHumanReview(selectedEvidence.id, 'Rejected')}
                    className="px-4 py-2 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <XCircle size={14} />
                    <span>Reject (Requires Remediation)</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
