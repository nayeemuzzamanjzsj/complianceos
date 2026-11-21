import { Router } from 'express';
import { db } from '../db.ts';
import { requireOrgRole, requireWorkspaceAuth } from '../services/auth.ts';
import {
  getCompanyProfile,
  getCompanyProfileVersions,
  saveCompanyProfile,
} from '../services/companyProfile.ts';
import {
  analyzeObligationApplicability,
  extractStructuredConditions,
  formatAssessmentRow,
  getApplicabilityQueueAndSummary,
  recalculateAllObligationsForOrg,
  retrieveObligationContext,
  reviewObligationAssessment,
} from '../services/applicabilityEngine.ts';

export const applicabilityRouter = Router();
applicabilityRouter.use(requireWorkspaceAuth);

// --- Versioned Company Profile Endpoints ---
applicabilityRouter.get('/company/profile', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const state = getCompanyProfile(orgId);
  if (!state) {
    res.status(404).json({ error: 'Organization profile not found.' });
    return;
  }
  const versions = getCompanyProfileVersions(orgId);
  res.json({
    ...state,
    versionsCount: versions.length,
    latestVersion: versions[0] || null,
  });
});

applicabilityRouter.put(
  '/company/profile',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const body = req.body ?? {};
    const {
      structuredProfile,
      profile,
      identity,
      business,
      scale,
      regulatory,
      geography,
      technology,
      risk_context,
      changeSummary,
      recalculate,
      completeOnboarding,
    } = body;

    // Support both `{ structuredProfile: {...} }` and direct sectioned payloads `{ identity, business, ... }`
    const patch =
      structuredProfile ||
      profile ||
      (identity || business || scale || regulatory || geography || technology || risk_context
        ? { identity, business, scale, regulatory, geography, technology, risk_context }
        : undefined);

    if (!patch || typeof patch !== 'object') {
      res.status(400).json({ error: 'Structured company profile payload is required.' });
      return;
    }

    const updated = saveCompanyProfile({
      orgId,
      structuredPatch: patch,
      completeOnboarding: Boolean(completeOnboarding),
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      changeSummary: typeof changeSummary === 'string' && changeSummary.trim() ? changeSummary.trim() : undefined,
    });

    let recalculatedCount = 0;
    if (recalculate === true) {
      const results = await recalculateAllObligationsForOrg(orgId, { useAi: false });
      recalculatedCount = results.length;
    }

    res.json({
      ...updated,
      recalculatedCount,
    });
  }
);

applicabilityRouter.get('/company/profile/versions', (req, res) => {
  const orgId = req.auth!.organizationId!;
  res.json(getCompanyProfileVersions(orgId));
});

// --- Applicability Queue, Summary, Detail, Analyze, Review & Recalculate ---
applicabilityRouter.get('/applicability', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const decisionFilter = String(req.query.decision || '').trim().toUpperCase();
  const jurisdictionFilter = String(req.query.jurisdiction || '').trim().toLowerCase();
  const reviewFilter = String(req.query.reviewStatus || '').trim().toUpperCase();
  const staleOnly = req.query.staleOnly === 'true';
  const q = String(req.query.q || '').trim().toLowerCase();

  const { summary, items } = getApplicabilityQueueAndSummary(orgId);

  const filtered = items.filter((item) => {
    if (decisionFilter && item.effective_decision !== decisionFilter) return false;
    if (jurisdictionFilter && !String(item.obligation.jurisdiction || '').toLowerCase().includes(jurisdictionFilter)) {
      return false;
    }
    if (reviewFilter) {
      const status = item.assessment?.human_review_status || 'PENDING_REVIEW';
      if (status !== reviewFilter) return false;
    }
    if (staleOnly && !item.is_stale) return false;
    if (q) {
      const hay = `${item.obligation.title} ${item.obligation.regulatory_identifier} ${item.obligation.regulator} ${item.obligation.jurisdiction} ${item.assessment?.reasoning_summary || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  res.json({ summary, items: filtered });
});

applicabilityRouter.post(
  '/applicability/recalculate',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const useAi = Boolean(req.body?.useAi);
    try {
      const results = await recalculateAllObligationsForOrg(orgId, { useAi });
      const { summary } = getApplicabilityQueueAndSummary(orgId);
      res.json({ ok: true, evaluatedCount: results.length, summary });
    } catch (err: any) {
      res.status(502).json({
        error: err?.message || 'Applicability recalculation failed.',
        code: 'RECALCULATION_ERROR',
      });
    }
  }
);

applicabilityRouter.get('/applicability/:obligationId', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const obligationId = req.params.obligationId;

  const obligationRow = db
    .prepare(
      `SELECT ro.*, rd.regulatory_identifier, rd.title as regulation_title, rd.document_type,
              rd.jurisdiction as regulation_jurisdiction, rd.country, rd.state_province,
              rd.publication_date, rd.effective_date, rd.source_url,
              rv.version_number, rv.content_hash
       FROM regulatory_obligations ro
       JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       JOIN regulatory_document_versions rv ON rv.id = ro.regulation_version_id
       WHERE ro.id = ?`
    )
    .get(obligationId) as any;

  if (!obligationRow) {
    res.status(404).json({ error: 'Regulatory obligation not found.' });
    return;
  }

  const profileState = getCompanyProfile(orgId);
  const conditions = extractStructuredConditions(obligationRow);
  const excerpts = retrieveObligationContext(obligationRow, orgId);

  const historyRows = db
    .prepare(
      `SELECT * FROM obligation_applicability_assessments
       WHERE organization_id = ? AND obligation_id = ?
       ORDER BY evaluated_at DESC, rowid DESC`
    )
    .all(orgId, obligationId) as Array<any>;

  const history = historyRows.map(formatAssessmentRow).filter(Boolean);
  const latestAssessment = history[0] || null;

  const linkedRemediations = db
    .prepare(
      `SELECT ra.*,
              (SELECT COUNT(*) FROM evidence_items ei WHERE ei.remediation_id = ra.id AND ei.organization_id = ra.organization_id) as evidence_count,
              (SELECT COUNT(*) FROM evidence_items ei WHERE ei.remediation_id = ra.id AND ei.organization_id = ra.organization_id AND ei.status = 'Accepted') as verified_evidence_count
       FROM remediation_actions ra
       WHERE ra.organization_id = ? AND ra.obligation_id = ?
       ORDER BY ra.created_at DESC`
    )
    .all(orgId, obligationId)
    .map((r: any) => ({
      ...r,
      requiredEvidence: JSON.parse(r.required_evidence_json || '[]'),
    }));

  res.json({
    obligation: {
      ...obligationRow,
      structuredConditions: conditions,
      evidenceRequired: JSON.parse(obligationRow.evidence_required_json || '[]'),
    },
    regulation: {
      id: obligationRow.regulation_id,
      regulatory_identifier: obligationRow.regulatory_identifier,
      title: obligationRow.regulation_title,
      document_type: obligationRow.document_type,
      regulator: obligationRow.regulator,
      jurisdiction: obligationRow.regulation_jurisdiction,
      state_province: obligationRow.state_province,
      version_number: obligationRow.version_number,
      publication_date: obligationRow.publication_date,
      effective_date: obligationRow.effective_date,
      source_url: obligationRow.source_url,
    },
    companyContext: profileState
      ? {
          organizationName: profileState.organization.name,
          profileVersion: profileState.versionNumber,
          completenessPct: profileState.completeness.pct,
          structuredProfile: profileState.structuredProfile,
        }
      : null,
    boundedExcerpts: excerpts,
    latestAssessment,
    assessmentHistory: history,
    linkedRemediations,
  });
});

applicabilityRouter.post(
  '/applicability/:obligationId/analyze',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const obligationId = req.params.obligationId;
    const useAi = req.body?.useAi !== false;

    try {
      const assessment = await analyzeObligationApplicability({
        orgId,
        obligationId,
        useAi,
      });
      res.status(201).json(assessment);
    } catch (err: any) {
      const msg = err?.message || 'Applicability analysis failed.';
      const status = msg.includes('not found') ? 404 : msg.includes('GEMINI_API_KEY') ? 502 : 400;
      res.status(status).json({ error: msg, code: status === 502 ? 'AI_UNAVAILABLE' : 'ANALYSIS_ERROR' });
    }
  }
);

applicabilityRouter.post(
  '/applicability/:obligationId/review',
  requireOrgRole(['org_admin', 'compliance_officer']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const obligationId = req.params.obligationId;
    const { action, overrideDecision, comment } = req.body ?? {};
    const validActions = new Set(['APPROVE', 'REJECT', 'REQUEST_MORE_INFO', 'OVERRIDE', 'COMMENT']);

    if (!validActions.has(String(action))) {
      res.status(400).json({ error: 'Action must be APPROVE, REJECT, REQUEST_MORE_INFO, OVERRIDE, or COMMENT.' });
      return;
    }

    try {
      const updated = reviewObligationAssessment({
        orgId,
        obligationId,
        action: String(action) as any,
        overrideDecision: overrideDecision ? (String(overrideDecision).toUpperCase() as any) : undefined,
        comment: typeof comment === 'string' ? comment : undefined,
        reviewerName: req.auth!.fullName,
        reviewerRole: req.auth!.role,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Review update failed.' });
    }
  }
);
