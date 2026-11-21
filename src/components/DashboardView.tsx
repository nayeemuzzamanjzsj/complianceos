import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Scale,
} from 'lucide-react';
import type { DashboardData, NavView, RegulationItem } from '../types';
import { DecisionBadge } from './ApplicabilityView';

interface DashboardViewProps {
  data: DashboardData | null;
  regulations: RegulationItem[];
  loading: boolean;
  onNavigate: (view: NavView, itemId?: string) => void;
}

const DonutGauge: React.FC<{
  percent: number;
  label: string;
  sublabel: string;
  color: string;
}> = ({ percent, label, sublabel, color }) => {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-20 h-20 shrink-0">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 84 84">
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke="#E2E8F0"
            strokeWidth="8"
          />
          <circle
            cx="42"
            cy="42"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center font-display text-sm font-bold text-[#0F172A] tabular-nums">
          {clamped}%
        </div>
      </div>
      <div>
        <div className="text-sm font-semibold text-[#0F172A]">{label}</div>
        <div className="text-xs text-[#64748B] mt-0.5">{sublabel}</div>
      </div>
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  regulations,
  loading,
  onNavigate,
}) => {
  if (loading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-white border border-[#E2E8F0] rounded-xl" />
          ))}
        </div>
        <div className="h-72 bg-white border border-[#E2E8F0] rounded-xl" />
      </div>
    );
  }

  const { posture, regulatorySummary, remediationBreakdown, evidenceBreakdown, recentActivity } = data;
  const attentionRegs = regulations.filter(
    (r) => r.applicability_status !== 'Not Applicable' && r.status !== 'Verified'
  );

  const barSeries =
    data.regulationLoad && data.regulationLoad.length > 0
      ? data.regulationLoad
      : [];
  const maxBarCount = Math.max(1, ...barSeries.flatMap((b) => [b.open, b.verified]));

  const totalActions =
    remediationBreakdown.notStarted +
    remediationBreakdown.inProgress +
    remediationBreakdown.readyForReview +
    remediationBreakdown.verified;
  const verifiedActionPct =
    totalActions > 0 ? Math.round((remediationBreakdown.verified / totalActions) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Top Question Banner */}
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-[#64748B]">
            Continuous Compliance Posture · {data.organization.name}
          </div>
          <h1 className="font-display text-xl font-bold text-[#0F172A] mt-1">
            {regulatorySummary.requiringAttention} regulatory changes require attention
          </h1>
          <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-[#475569]">
            <span className="font-semibold text-red-700 tabular-nums">
              {regulatorySummary.critical} Critical
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-amber-700 tabular-nums">
              {regulatorySummary.high} High
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-semibold text-[#2563EB] tabular-nums">
              {regulatorySummary.medium} Medium
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {regulatorySummary.dismissed} Dismissed (Non-Applicable)
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() =>
              onNavigate('regulations', attentionRegs[0]?.id)
            }
            className="px-4 py-2.5 rounded-lg bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>Inspect Primary Regulatory Change</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {/* 4 Posture KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Compliance Posture</span>
            <Scale size={15} className="text-[#2563EB]" />
          </div>
          <div className="font-display text-2xl font-bold text-[#0F172A] mt-2 tabular-nums">
            {posture.complianceCoveragePct}%
          </div>
          <div className="text-xs text-[#475569] mt-1">
            Status: <span className="font-semibold text-[#0F172A]">{posture.overallStatus}</span>
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>High-Risk Findings</span>
            <AlertTriangle size={15} className="text-amber-600" />
          </div>
          <div className="font-display text-2xl font-bold text-[#0F172A] mt-2 tabular-nums">
            {posture.highRiskFindings}
          </div>
          <div className="text-xs text-[#475569] mt-1">
            {posture.pendingPolicyApprovals} policy diffs awaiting approval
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Open Remediation Actions</span>
            <ClipboardList size={15} className="text-[#2563EB]" />
          </div>
          <div className="font-display text-2xl font-bold text-[#0F172A] mt-2 tabular-nums">
            {posture.openActionsCount}
          </div>
          <div className="text-xs text-[#475569] mt-1 tabular-nums">
            {remediationBreakdown.readyForReview} awaiting review · {remediationBreakdown.overdue} overdue
          </div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5">
          <div className="flex items-center justify-between text-xs font-medium text-[#64748B]">
            <span>Verified Controls</span>
            <CheckCircle2 size={15} className="text-emerald-600" />
          </div>
          <div className="font-display text-2xl font-bold text-[#0F172A] mt-2 tabular-nums">
            {posture.verifiedControlsCount} / {posture.totalControlsCount}
          </div>
          <div className="text-xs text-[#475569] mt-1 tabular-nums">
            {posture.evidenceGapsCount} evidence gaps remaining
          </div>
        </div>
      </div>

      {/* Regulatory Intelligence & Change Detection Metrics Strip */}
      {data.regulatoryIntelligence && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Regulatory Intelligence &amp; Change Detection
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Multi-jurisdiction regulatory monitoring, immutable version diffs, and extracted compliance obligations
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('regulations')}
              className="text-xs font-semibold text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Open Regulatory Intelligence</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Sources Monitored', value: data.regulatoryIntelligence.sourcesMonitored, accent: 'text-[#0F172A]' },
              { label: 'Regulations Tracked', value: data.regulatoryIntelligence.regulationsTracked, accent: 'text-[#0F172A]' },
              { label: 'Changes Detected', value: data.regulatoryIntelligence.changesDetected, accent: 'text-[#2563EB]' },
              { label: 'Material Changes', value: data.regulatoryIntelligence.materialChanges, accent: 'text-amber-700' },
              { label: 'New Obligations', value: data.regulatoryIntelligence.newObligations, accent: 'text-[#2563EB]' },
              { label: 'High-Severity Changes', value: data.regulatoryIntelligence.highSeverityChanges, accent: 'text-red-700' },
              { label: 'Unreviewed Changes', value: data.regulatoryIntelligence.unreviewedChanges, accent: 'text-amber-700' },
            ].map((m) => (
              <div key={m.label} className="border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-medium text-[#64748B] leading-tight">{m.label}</div>
                <div className={`font-display text-lg font-bold mt-1 tabular-nums ${m.accent}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {data.regulatoryIntelligence.recentChanges.length > 0 && (
            <div className="border-t border-[#E2E8F0] pt-4">
              <div className="text-xs font-semibold text-[#475569] mb-2.5">
                Latest Detected Regulatory Changes
              </div>
              <div className="divide-y divide-[#E2E8F0] border border-[#E2E8F0] rounded-lg overflow-hidden">
                {data.regulatoryIntelligence.recentChanges.slice(0, 4).map((ch) => (
                  <div
                    key={ch.id}
                    className="px-4 py-3 bg-white hover:bg-[#F8FAFC] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#64748B]">
                        <span className="font-mono font-bold text-[#0F172A]">{ch.regulatory_identifier}</span>
                        <span>·</span>
                        <span className="font-medium text-[#334155]">{ch.regulator}</span>
                        <span>·</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[#334155] font-medium">{ch.jurisdiction}</span>
                        <span>·</span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[#2563EB] font-semibold">{ch.change_type}</span>
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
                        {ch.org_review_status === 'UNREVIEWED' && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-semibold">
                            Unreviewed
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-semibold text-[#0F172A] mt-1 truncate">
                        {ch.regulation_title}
                      </div>
                      <div className="text-xs text-[#64748B] mt-0.5 line-clamp-1">
                        {ch.aiSummary?.summary || ch.diff_summary_text}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] font-mono text-[#64748B] tabular-nums">
                        {ch.affected_obligation_count} obligations
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate('regulations', ch.id)}
                        className="px-3 py-1.5 rounded-md border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] text-xs font-semibold text-[#0F172A] cursor-pointer whitespace-nowrap"
                      >
                        View Change
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Company-Specific Applicability Engine Section */}
      {data.applicabilitySummary && (
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Applicability
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Profile-grounded applicability verdicts for {data.organization.name} (Profile v
                {data.applicabilitySummary.profileVersion} · {data.applicabilitySummary.profileCompletenessPct}% completeness)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('applicability')}
              className="text-xs font-semibold text-[#2563EB] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span>Open Applicability Engine</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Applicable Obligations', value: data.applicabilitySummary.applicable, accent: 'text-emerald-700' },
              { label: 'Potentially Applicable', value: data.applicabilitySummary.potentiallyApplicable, accent: 'text-amber-700' },
              { label: 'Requires Review', value: data.applicabilitySummary.requiresReview, accent: 'text-[#2563EB]' },
              { label: 'Insufficient Information', value: data.applicabilitySummary.insufficientInformation, accent: 'text-orange-700' },
              { label: 'Not Applicable', value: data.applicabilitySummary.notApplicable, accent: 'text-slate-600' },
              { label: 'New Applicable Obligations', value: data.applicabilitySummary.newApplicableObligations, accent: 'text-[#2563EB]' },
            ].map((m) => (
              <div key={m.label} className="border border-[#E2E8F0] bg-[#F8FAFC] rounded-lg px-3 py-2.5">
                <div className="text-[11px] font-medium text-[#64748B] leading-tight">{m.label}</div>
                <div className={`font-display text-lg font-bold mt-1 tabular-nums ${m.accent}`}>{m.value}</div>
              </div>
            ))}
          </div>

          {data.applicabilitySummary.items.length > 0 && (
            <div className="border border-[#E2E8F0] rounded-lg overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#F8FAFC] border-b border-[#E2E8F0] text-[#64748B]">
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Obligation</th>
                    <th className="px-3.5 py-2.5 font-semibold">Regulation</th>
                    <th className="px-3.5 py-2.5 font-semibold">Decision</th>
                    <th className="px-3.5 py-2.5 font-semibold">Confidence</th>
                    <th className="px-3.5 py-2.5 font-semibold">Reason</th>
                    <th className="px-3.5 py-2.5 font-semibold">Review</th>
                    <th className="px-3.5 py-2.5 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {data.applicabilitySummary.items.slice(0, 6).map((item) => (
                    <tr key={item.obligationId} className="hover:bg-[#F8FAFC]">
                      <td className="px-3.5 py-2.5 font-medium text-[#0F172A] max-w-[220px] truncate">
                        {item.obligationTitle}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-[11px] text-[#334155] whitespace-nowrap">
                        {item.regulatoryIdentifier}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <DecisionBadge decision={item.decision} />
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-[#475569]">
                        {item.confidenceLevel} confidence
                      </td>
                      <td className="px-3.5 py-2.5 text-[#475569] max-w-[260px] truncate">
                        {item.reason}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-mono text-[#334155]">
                          {item.reviewStatus}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onNavigate('applicability', item.obligationId)}
                          className="px-2.5 py-1 rounded border border-[#CBD5E1] bg-white hover:bg-[#EFF6FF] hover:border-[#2563EB] text-[11px] font-semibold text-[#0F172A] cursor-pointer"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Middle Visual Grid: Bar Chart + Certainty Gauges + Attention List */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 bg-white border border-[#E2E8F0] rounded-xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Regulatory Impact & Remediation Load
              </h2>
              <p className="text-xs text-[#64748B] mt-0.5">
                Open actions vs. verified controls across active directives
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#475569]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB] inline-block" />
                Open Actions
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#16A34A] inline-block" />
                Verified
              </span>
            </div>
          </div>

          <div className="h-52 flex items-end justify-between gap-4 pt-4 border-b border-[#E2E8F0] pb-3 px-2">
            {barSeries.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-xs text-[#64748B]">
                No remediation actions recorded yet for active directives.
              </div>
            ) : (
              barSeries.map((item) => {
                const openH = item.open > 0 ? Math.max(14, Math.round((item.open / maxBarCount) * 136)) : 4;
                const verH = item.verified > 0 ? Math.max(14, Math.round((item.verified / maxBarCount) * 136)) : 4;
                return (
                  <div key={item.label} className="flex-1 flex flex-col items-center gap-2">
                    <div className="flex items-end gap-1.5 h-36">
                      <div
                        style={{ height: `${openH}px` }}
                        className="w-4 sm:w-5 bg-[#2563EB] rounded-t-sm transition-all"
                        title={`${item.open} open`}
                      />
                      <div
                        style={{ height: `${verH}px` }}
                        className="w-4 sm:w-5 bg-[#16A34A] rounded-t-sm transition-all"
                        title={`${item.verified} verified`}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-[#64748B] truncate max-w-full">
                      {item.label}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-5">
            <DonutGauge
              percent={posture.complianceCoveragePct}
              label="Control Coverage"
              sublabel={`${posture.verifiedControlsCount} of ${posture.totalControlsCount} controls verified`}
              color="#2563EB"
            />
            <DonutGauge
              percent={verifiedActionPct}
              label="Verification Progress"
              sublabel={`${remediationBreakdown.verified} of ${totalActions} actions verified`}
              color="#16A34A"
            />
          </div>
        </div>

        {/* Right Column: Remediation & Evidence Summary */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Remediation Pipeline
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('remediation')}
                className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Open Center
              </button>
            </div>
            <div className="space-y-3 text-xs">
              {[
                { label: 'Not Started', count: remediationBreakdown.notStarted, color: 'bg-slate-400' },
                { label: 'In Progress', count: remediationBreakdown.inProgress, color: 'bg-[#2563EB]' },
                { label: 'Awaiting Review / Implemented', count: remediationBreakdown.readyForReview, color: 'bg-amber-500' },
                { label: 'Verified', count: remediationBreakdown.verified, color: 'bg-emerald-600' },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-[#475569]">{row.label}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-28 h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                      <div
                        className={`h-full ${row.color}`}
                        style={{
                          width: `${totalActions > 0 ? Math.round((row.count / totalActions) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="font-mono font-semibold text-[#0F172A] tabular-nums w-5 text-right">
                      {row.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm font-bold text-[#0F172A]">
                Evidence Verification Queue
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('evidence')}
                className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
              >
                Prove & Verify
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <div className="text-[#64748B]">Under Review</div>
                <div className="font-display text-lg font-bold text-amber-700 mt-0.5 tabular-nums">
                  {evidenceBreakdown.underReview}
                </div>
              </div>
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <div className="text-[#64748B]">Accepted / Verified</div>
                <div className="font-display text-lg font-bold text-emerald-700 mt-0.5 tabular-nums">
                  {evidenceBreakdown.accepted}
                </div>
              </div>
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <div className="text-[#64748B]">Missing Proof</div>
                <div className="font-display text-lg font-bold text-[#0F172A] mt-0.5 tabular-nums">
                  {evidenceBreakdown.missing}
                </div>
              </div>
              <div className="border border-[#E2E8F0] rounded-lg p-3">
                <div className="text-[#64748B]">Rejected</div>
                <div className="font-display text-lg font-bold text-red-700 mt-0.5 tabular-nums">
                  {evidenceBreakdown.rejected}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Priority Regulatory Queue & Recent Activity */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-7 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Applicable Regulatory Changes
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('regulations')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              View All
            </button>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {attentionRegs.map((reg) => (
              <button
                key={reg.id}
                type="button"
                onClick={() => onNavigate('regulations', reg.id)}
                className="w-full text-left px-6 py-4 hover:bg-[#F8FAFC] transition-colors flex items-center justify-between gap-4 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[#64748B]">
                    <span className="font-mono font-semibold text-[#0F172A]">{reg.code}</span>
                    <span aria-hidden="true">·</span>
                    <span>{reg.regulator}</span>
                    <span aria-hidden="true">·</span>
                    <span>Effective {reg.effective_date}</span>
                  </div>
                  <div className="text-sm font-semibold text-[#0F172A] mt-1 truncate">
                    {reg.title}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0 text-xs">
                  <span
                    className={`font-semibold ${
                      reg.severity === 'Critical'
                        ? 'text-red-700'
                        : reg.severity === 'High'
                        ? 'text-amber-700'
                        : 'text-[#2563EB]'
                    }`}
                  >
                    {reg.severity}
                  </span>
                  <ArrowRight size={14} className="text-[#64748B]" />
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="xl:col-span-5 bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-[#0F172A]">
              Recent Compliance Activity
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('audit-log')}
              className="text-xs font-semibold text-[#2563EB] hover:underline cursor-pointer"
            >
              Full Audit Trail
            </button>
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {recentActivity.slice(0, 6).map((ev) => (
              <div key={ev.id} className="px-6 py-3 flex items-start justify-between gap-3 text-xs">
                <div>
                  <div className="font-semibold text-[#0F172A]">{ev.action}</div>
                  <div className="text-[#64748B] mt-0.5">
                    {ev.object_label} · {ev.actor_name}
                  </div>
                </div>
                <div className="font-mono text-[#64748B] shrink-0 tabular-nums">
                  {new Date(ev.timestamp).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
