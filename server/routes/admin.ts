import { Router } from 'express';
import { db } from '../db.ts';
import { requirePlatformAdmin } from '../services/auth.ts';

export const adminRouter = Router();
adminRouter.use(requirePlatformAdmin);

adminRouter.get('/overview', (_req, res) => {
  const totalOrgs = (db.prepare(`SELECT COUNT(*) as c FROM organizations`).get() as { c: number }).c;
  const totalUsers = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  const activeOrgs = (db.prepare(`SELECT COUNT(*) as c FROM organizations WHERE onboarding_completed = 1`).get() as { c: number }).c;
  const totalDocuments = (db.prepare(`SELECT COUNT(*) as c FROM documents`).get() as { c: number }).c;
  const legacyAnalyses = (db.prepare(`SELECT COUNT(*) as c FROM applicability_assessments`).get() as { c: number }).c;
  const obligationAnalyses = (
    db.prepare(`SELECT COUNT(*) as c FROM obligation_applicability_assessments`).get() as { c: number }
  ).c;
  const totalAnalyses = legacyAnalyses + obligationAnalyses;
  const openActions = (
    db.prepare(`SELECT COUNT(*) as c FROM remediation_actions WHERE status != 'Verified'`).get() as { c: number }
  ).c;
  const verifiedControls = (
    db.prepare(`SELECT COUNT(*) as c FROM controls WHERE verification_status = 'Verified'`).get() as { c: number }
  ).c;
  const totalEvidence = (db.prepare(`SELECT COUNT(*) as c FROM evidence_items`).get() as { c: number }).c;

  // Aggregated org telemetry only — NEVER expose private organization documents or raw text to platform admin
  const organizations = db
    .prepare(
      `SELECT
        o.id,
        o.name,
        o.country,
        o.industry,
        o.size,
        o.onboarding_completed,
        o.is_demo,
        o.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) as user_count,
        (SELECT COUNT(*) FROM documents d WHERE d.organization_id = o.id) as document_count,
        (SELECT COUNT(*) FROM regulations r WHERE r.organization_id = o.id) as regulation_count,
        (SELECT COUNT(*) FROM remediation_actions ra WHERE ra.organization_id = o.id AND ra.status != 'Verified') as open_action_count,
        (SELECT COUNT(*) FROM controls c WHERE c.organization_id = o.id AND c.verification_status = 'Verified') as verified_control_count
      FROM organizations o
      ORDER BY o.created_at ASC`
    )
    .all();

  const recentSystemEvents = db
    .prepare(
      `SELECT
        ae.id,
        ae.timestamp,
        o.name as organization_name,
        ae.action,
        ae.object_type,
        ae.new_state
      FROM audit_events ae
      JOIN organizations o ON o.id = ae.organization_id
      ORDER BY ae.timestamp DESC
      LIMIT 15`
    )
    .all();

  const processingBreakdown = db
    .prepare(`SELECT status, COUNT(*) as count FROM documents GROUP BY status`)
    .all();

  res.json({
    metrics: {
      totalOrganizations: totalOrgs,
      totalUsers,
      activeOrganizations: activeOrgs,
      documentsProcessed: totalDocuments,
      regulatoryAnalyses: totalAnalyses,
      openRemediationActions: openActions,
      verifiedControls,
      totalEvidence,
    },
    organizations,
    processingBreakdown,
    recentSystemEvents,
  });
});
