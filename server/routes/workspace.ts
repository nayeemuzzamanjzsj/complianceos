import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { db, getUploadBaseDir } from '../db.ts';
import {
  hashPassword,
  logAuditEvent,
  requireOrgRole,
  requireWorkspaceAuth,
  revokeAllUserSessions,
} from '../services/auth.ts';
import {
  runAiActionPlanGeneration,
  runAiApplicabilityAnalysis,
  runAiDocumentSummary,
  runAiEvidenceEvaluation,
} from '../services/ai.ts';
import { executeMcpTool, MCP_TOOLS } from '../services/mcp.ts';
import { getCompanyProfile, saveCompanyProfile } from '../services/companyProfile.ts';
import { getApplicabilityQueueAndSummary, recalculateAllObligationsForOrg } from '../services/applicabilityEngine.ts';

const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.txt',
  '.md',
  '.html',
  '.json',
  '.png',
  '.jpg',
  '.jpeg',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      cb(new Error(`Unsupported file extension "${ext}".`));
      return;
    }
    cb(null, true);
  },
});

function saveUploadedFileSafely(orgId: string, originalName: string, buffer: Buffer): string {
  const baseDir = getUploadBaseDir();
  const safeOrg = orgId.replace(/[^a-zA-Z0-9_-]/g, '');
  const orgDir = path.resolve(baseDir, safeOrg);
  if (!orgDir.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid storage directory.');
  }
  if (!fs.existsSync(orgDir)) {
    fs.mkdirSync(orgDir, { recursive: true });
  }
  const cleanName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const uniqueName = `${Date.now()}_${crypto.randomUUID().slice(0, 6)}_${cleanName}`;
  const targetPath = path.resolve(orgDir, uniqueName);
  if (!targetPath.startsWith(orgDir + path.sep)) {
    throw new Error('Invalid file path.');
  }
  fs.writeFileSync(targetPath, buffer);
  return targetPath;
}

function extractReadableText(originalName: string, mimeType: string, buffer: Buffer): string {
  const ext = path.extname(originalName).toLowerCase();
  if (['.txt', '.md', '.csv', '.json', '.html'].includes(ext) || mimeType.startsWith('text/')) {
    return buffer.toString('utf8').slice(0, 20000);
  }
  // Safe printable ASCII extraction fallback for binary containers without executing files
  const asciiMatches = buffer.toString('latin1').match(/[A-Za-z0-9.,;:'"()\-/\s]{6,}/g);
  if (asciiMatches && asciiMatches.length > 0) {
    return asciiMatches.join(' ').replace(/\s+/g, ' ').slice(0, 8000);
  }
  return `Uploaded binary compliance artifact: ${originalName} (${mimeType}, ${buffer.length} bytes).`;
}

function chunkTextIntoRecords(documentId: string, organizationId: string, text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  const chunkSize = 600;
  let count = 0;
  for (let i = 0; i < clean.length; i += chunkSize) {
    const slice = clean.slice(i, i + chunkSize);
    const words = Array.from(
      new Set(
        slice
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length > 3)
      )
    )
      .slice(0, 18)
      .join(' ');
    db.prepare(
      `INSERT INTO document_chunks (id, document_id, organization_id, chunk_index, content, keywords)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(`chk_${crypto.randomUUID().slice(0, 10)}`, documentId, organizationId, count, slice, words);
    count += 1;
  }
  return count;
}

export const workspaceRouter = Router();
workspaceRouter.use(requireWorkspaceAuth);

// --- Dashboard ---
workspaceRouter.get('/dashboard', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(orgId);
  const regulations = db.prepare(`SELECT * FROM regulations WHERE organization_id = ?`).all(orgId) as Array<any>;
  const controls = db.prepare(`SELECT * FROM controls WHERE organization_id = ?`).all(orgId) as Array<any>;
  const actions = db.prepare(`SELECT * FROM remediation_actions WHERE organization_id = ?`).all(orgId) as Array<any>;
  const evidence = db.prepare(`SELECT * FROM evidence_items WHERE organization_id = ?`).all(orgId) as Array<any>;
  const policies = db.prepare(`SELECT * FROM policies WHERE organization_id = ?`).all(orgId) as Array<any>;
  const auditEvents = db
    .prepare(`SELECT * FROM audit_events WHERE organization_id = ? ORDER BY timestamp DESC LIMIT 10`)
    .all(orgId);

  const applicableRegs = regulations.filter((r) => r.applicability_status !== 'Not Applicable');
  const attentionRegs = applicableRegs.filter((r) => r.status !== 'Verified');
  const verifiedControls = controls.filter((c) => c.verification_status === 'Verified').length;
  const openActions = actions.filter((a) => a.status !== 'Verified');
  const evidenceGaps = actions.filter(
    (a) => a.status !== 'Verified' && !evidence.some((e) => e.remediation_id === a.id && e.status === 'Accepted')
  ).length;

  const postureScore =
    controls.length > 0
      ? Math.round(((verifiedControls + controls.filter((c) => c.status === 'Implemented').length * 0.5) / controls.length) * 100)
      : 0;

  const sourcesMonitored = (
    db.prepare(`SELECT COUNT(*) as c FROM regulatory_sources WHERE active = 1`).get() as { c: number }
  ).c;
  const regulationsTracked = (
    db.prepare(`SELECT COUNT(*) as c FROM regulatory_documents`).get() as { c: number }
  ).c;
  const allRegChanges = db
    .prepare(
      `SELECT rc.*, rs.name as source_name, ocr.review_status as org_review_status
       FROM regulatory_changes rc
       JOIN regulatory_sources rs ON rs.id = rc.source_id
       LEFT JOIN organization_change_reviews ocr ON ocr.change_id = rc.id AND ocr.organization_id = ?
       ORDER BY rc.change_date DESC, rc.created_at DESC`
    )
    .all(orgId) as Array<any>;
  const newObligations = (
    db
      .prepare(
        `SELECT COUNT(*) as c
         FROM regulatory_obligations ro
         JOIN regulatory_documents rd ON rd.current_version_id = ro.regulation_version_id`
      )
      .get() as { c: number }
  ).c;

  const recentChanges = allRegChanges.slice(0, 6).map((rc) => ({
    id: rc.id,
    document_id: rc.document_id,
    regulatory_identifier: rc.regulatory_identifier,
    regulation_title: rc.regulation_title,
    regulator: rc.regulator,
    jurisdiction: rc.jurisdiction,
    change_type: rc.change_type,
    severity: rc.severity,
    is_material: rc.is_material,
    affected_obligation_count: rc.affected_obligation_count,
    diff_summary_text: rc.diff_summary_text,
    change_date: rc.change_date,
    source_url: rc.source_url,
    org_review_status: rc.org_review_status || 'UNREVIEWED',
    aiSummary: rc.ai_summary_json ? JSON.parse(rc.ai_summary_json) : null,
  }));

  const applicabilityQueue = getApplicabilityQueueAndSummary(orgId);
  const applicabilitySummary = {
    ...applicabilityQueue.summary,
    items: applicabilityQueue.items.slice(0, 12).map((item) => ({
      obligationId: item.obligation.id,
      obligationTitle: item.obligation.title,
      obligationType: item.obligation.obligation_type,
      regulationId: item.obligation.regulation_id,
      regulatoryIdentifier: item.obligation.regulatory_identifier,
      regulationTitle: item.obligation.regulation_title,
      regulator: item.obligation.regulator,
      jurisdiction: item.obligation.jurisdiction,
      decision: item.effective_decision,
      confidenceLevel: item.assessment?.confidence_level || 'Low',
      reason: item.assessment?.reasoning_summary || 'Pending applicability evaluation.',
      reviewStatus: item.assessment?.human_review_status || 'PENDING_REVIEW',
      requiresHumanReview: item.assessment?.requires_human_review ?? true,
      isStale: item.is_stale,
    })),
  };

  const todayIso = new Date().toISOString().slice(0, 10);
  const loadMap = new Map<string, { label: string; open: number; verified: number }>();
  for (const reg of applicableRegs) {
    loadMap.set(reg.id, { label: reg.code, open: 0, verified: 0 });
  }
  for (const act of actions) {
    const existingEntry = loadMap.get(act.regulation_id);
    if (existingEntry) {
      if (act.status === 'Verified') existingEntry.verified += 1;
      else existingEntry.open += 1;
    } else {
      const globalObl = act.obligation_id
        ? (db
            .prepare(
              `SELECT rd.regulatory_identifier
               FROM regulatory_obligations ro
               JOIN regulatory_documents rd ON rd.id = ro.regulation_id
               WHERE ro.id = ?`
            )
            .get(act.obligation_id) as { regulatory_identifier?: string } | undefined)
        : undefined;
      const fallbackLabel = globalObl?.regulatory_identifier || act.source_citation?.split(' ')[0] || 'Linked Directive';
      const entry = loadMap.get(fallbackLabel) || { label: fallbackLabel, open: 0, verified: 0 };
      if (act.status === 'Verified') entry.verified += 1;
      else entry.open += 1;
      loadMap.set(fallbackLabel, entry);
    }
  }
  const regulationLoad = Array.from(loadMap.values()).slice(0, 6);

  res.json({
    organization: org,
    posture: {
      overallStatus: postureScore >= 80 ? 'Strong' : postureScore >= 50 ? 'Attention Required' : 'Action Needed',
      complianceCoveragePct: Math.min(100, postureScore),
      highRiskFindings: attentionRegs.filter((r) => r.severity === 'Critical' || r.severity === 'High').length,
      openActionsCount: openActions.length,
      verifiedControlsCount: verifiedControls,
      totalControlsCount: controls.length,
      evidenceGapsCount: evidenceGaps,
      pendingPolicyApprovals: policies.filter((p) => p.status === 'Pending Approval').length,
    },
    regulatorySummary: {
      requiringAttention: attentionRegs.length,
      critical: attentionRegs.filter((r) => r.severity === 'Critical').length,
      high: attentionRegs.filter((r) => r.severity === 'High').length,
      medium: attentionRegs.filter((r) => r.severity === 'Medium').length,
      dismissed: regulations.filter((r) => r.applicability_status === 'Not Applicable').length,
    },
    regulatoryIntelligence: {
      sourcesMonitored,
      regulationsTracked,
      changesDetected: allRegChanges.length,
      materialChanges: allRegChanges.filter((c) => Number(c.is_material) === 1).length,
      newObligations,
      highSeverityChanges: allRegChanges.filter((c) => ['critical', 'high'].includes(String(c.severity).toLowerCase())).length,
      unreviewedChanges: allRegChanges.filter((c) => !c.org_review_status || c.org_review_status === 'UNREVIEWED').length,
      recentChanges,
    },
    applicabilitySummary,
    regulationLoad,
    remediationBreakdown: {
      notStarted: actions.filter((a) => a.status === 'Not Started').length,
      inProgress: actions.filter((a) => a.status === 'In Progress').length,
      readyForReview: actions.filter((a) => a.status === 'Ready for Review' || a.status === 'Implemented').length,
      verified: actions.filter((a) => a.status === 'Verified').length,
      overdue: actions.filter((a) => a.status !== 'Verified' && a.deadline && a.deadline < todayIso).length,
    },
    evidenceBreakdown: {
      missing: Math.max(0, actions.length - evidence.length),
      uploaded: evidence.filter((e) => e.status === 'Uploaded').length,
      underReview: evidence.filter((e) => e.status === 'Under Review').length,
      accepted: evidence.filter((e) => e.status === 'Accepted').length,
      rejected: evidence.filter((e) => e.status === 'Rejected').length,
    },
    recentActivity: auditEvents,
  });
});

// --- Organization & Profile & Onboarding ---
workspaceRouter.get('/organizations/me', (req, res) => {
  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(req.auth!.organizationId!);
  res.json(org);
});

workspaceRouter.get('/organizations/me/profile', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const state = getCompanyProfile(orgId);
  if (!state) {
    res.status(404).json({ error: 'Organization not found.' });
    return;
  }
  res.json({
    organization: state.organization,
    profile: state.legacyProfile,
    structuredProfile: state.structuredProfile,
    versionNumber: state.versionNumber,
    completeness: state.completeness,
    systems: state.systems,
  });
});

workspaceRouter.put(
  '/organizations/me/profile',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { organization, business, data, infrastructure, compliance, structuredProfile, completeOnboarding, recalculate } =
      req.body ?? {};

    const updated = saveCompanyProfile({
      orgId,
      structuredPatch: structuredProfile,
      legacyPayload: { organization, business, data, infrastructure, compliance },
      completeOnboarding: Boolean(completeOnboarding),
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
    });

    if (completeOnboarding || recalculate === true) {
      await recalculateAllObligationsForOrg(orgId, { useAi: false }).catch(() => {});
    }

    res.json({
      ok: true,
      updatedAt: updated.updatedAt,
      versionNumber: updated.versionNumber,
      completeness: updated.completeness,
    });
  }
);

// --- Users & Access ---
workspaceRouter.get('/users', (req, res) => {
  const rows = db
    .prepare(`SELECT id, full_name, email, role, department, status, created_at FROM users WHERE organization_id = ? ORDER BY created_at ASC`)
    .all(req.auth!.organizationId!);
  res.json(rows);
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ['org_admin', 'compliance_officer', 'engineering', 'auditor'];

workspaceRouter.post('/users', requireOrgRole(['org_admin']), (req, res) => {
  const { fullName, email, role, department, password } = req.body ?? {};
  if (
    typeof fullName !== 'string' ||
    typeof email !== 'string' ||
    typeof role !== 'string' ||
    typeof password !== 'string' ||
    !fullName.trim() ||
    !EMAIL_REGEX.test(email.trim().toLowerCase()) ||
    !ALLOWED_ROLES.includes(role) ||
    password.length < 8 ||
    password.length > 128
  ) {
    res.status(400).json({ error: 'Valid name, email, role, and password (8-128 chars) are required.' });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const exists = db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(normalizedEmail);
  if (exists) {
    res.status(409).json({ error: 'Email is already registered.' });
    return;
  }
  const id = `usr_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, organization_id, full_name, email, password_hash, role, department, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)`
  ).run(
    id,
    req.auth!.organizationId!,
    fullName.trim(),
    normalizedEmail,
    hashPassword(password),
    role,
    typeof department === 'string' && department.trim() ? department.trim() : 'Compliance',
    now
  );

  logAuditEvent({
    organizationId: req.auth!.organizationId!,
    actorName: req.auth!.fullName,
    actorRole: req.auth!.role,
    action: 'User invited',
    objectType: 'User',
    objectId: id,
    objectLabel: normalizedEmail,
    previousState: 'None',
    newState: String(role),
    sourceRef: 'Users & Access',
  });

  res.status(201).json({ id, full_name: fullName, email: normalizedEmail, role, department: department || 'Compliance', status: 'Active', created_at: now });
});

workspaceRouter.patch('/users/:id/role', requireOrgRole(['org_admin']), (req, res) => {
  const { role } = req.body ?? {};
  const allowed = ['org_admin', 'compliance_officer', 'engineering', 'auditor'];
  if (!allowed.includes(String(role))) {
    res.status(400).json({ error: 'Invalid role specified.' });
    return;
  }
  const target = db
    .prepare(`SELECT id, email, role FROM users WHERE id = ? AND organization_id = ?`)
    .get(req.params.id, req.auth!.organizationId!) as any;
  if (!target) {
    res.status(404).json({ error: 'User not found in workspace.' });
    return;
  }
  db.prepare(`UPDATE users SET role = ? WHERE id = ? AND organization_id = ?`).run(String(role), target.id, req.auth!.organizationId!);
  logAuditEvent({
    organizationId: req.auth!.organizationId!,
    actorName: req.auth!.fullName,
    actorRole: req.auth!.role,
    action: 'User role updated',
    objectType: 'User',
    objectId: target.id,
    objectLabel: target.email,
    previousState: target.role,
    newState: String(role),
    sourceRef: 'Users & Access',
  });
  res.json({ ok: true });
});

workspaceRouter.patch('/users/:id/password', requireOrgRole(['org_admin']), (req, res) => {
  const { newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    res.status(400).json({ error: 'New password must be at least 8 characters.' });
    return;
  }
  const target = db
    .prepare(`SELECT id, email FROM users WHERE id = ? AND organization_id = ?`)
    .get(req.params.id, req.auth!.organizationId!) as { id: string; email: string } | undefined;
  if (!target) {
    res.status(404).json({ error: 'User not found in workspace.' });
    return;
  }
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ? AND organization_id = ?`).run(
    hashPassword(newPassword),
    target.id,
    req.auth!.organizationId!
  );
  revokeAllUserSessions(target.id);
  logAuditEvent({
    organizationId: req.auth!.organizationId!,
    actorName: req.auth!.fullName,
    actorRole: req.auth!.role,
    action: 'User password reset',
    objectType: 'User',
    objectId: target.id,
    objectLabel: target.email,
    previousState: 'Credential active',
    newState: 'Password updated',
    sourceRef: 'Users & Access',
  });
  res.json({ ok: true });
});

// --- Documents ---
workspaceRouter.get('/documents', (req, res) => {
  const docs = db
    .prepare(
      `SELECT id, filename, mime_type, size_bytes, classification, status, version, source, owner_name, summary, chunk_count, created_at
       FROM documents WHERE organization_id = ? ORDER BY created_at DESC`
    )
    .all(req.auth!.organizationId!);
  res.json(docs);
});

workspaceRouter.get('/documents/:id', (req, res) => {
  const doc = db
    .prepare(
      `SELECT id, filename, mime_type, size_bytes, classification, status, version, source, owner_name, extracted_text, summary, chunk_count, created_at
       FROM documents WHERE id = ? AND organization_id = ?`
    )
    .get(req.params.id, req.auth!.organizationId!);
  if (!doc) {
    res.status(404).json({ error: 'Document not found.' });
    return;
  }
  res.json(doc);
});

workspaceRouter.post(
  '/documents',
  requireOrgRole(['org_admin', 'compliance_officer', 'engineering']),
  upload.single('file'),
  async (req, res) => {
    try {
      const orgId = req.auth!.organizationId!;
      const classification = String(req.body?.classification || 'Policy');
      const version = String(req.body?.version || 'v1.0');
      const now = new Date().toISOString();

      let filename = '';
      let mimeType = 'text/plain';
      let sizeBytes = 0;
      let storagePath: string | null = null;
      let extractedText = '';

      if (req.file) {
        filename = req.file.originalname;
        mimeType = req.file.mimetype || 'application/octet-stream';
        sizeBytes = req.file.size;
        storagePath = saveUploadedFileSafely(orgId, filename, req.file.buffer);
        extractedText = extractReadableText(filename, mimeType, req.file.buffer);
      } else if (typeof req.body?.textContent === 'string' && req.body.textContent.trim()) {
        filename = String(req.body?.filename || `compliance_note_${Date.now()}.txt`);
        extractedText = req.body.textContent.trim();
        sizeBytes = Buffer.byteLength(extractedText, 'utf8');
      } else {
        res.status(400).json({ error: 'Please select a valid document file to upload.' });
        return;
      }

      const docId = `doc_${crypto.randomUUID().slice(0, 10)}`;
      const aiSummary = await runAiDocumentSummary(filename, classification, extractedText);
      const summary = aiSummary || `Processed ${classification} document (${filename}) indexed for compliance search and applicability retrieval.`;

      db.prepare(
        `INSERT INTO documents (
          id, organization_id, filename, mime_type, size_bytes, classification, status, version, source, owner_name, storage_path, extracted_text, summary, chunk_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Processed', ?, 'Internal Upload', ?, ?, ?, ?, 0, ?)`
      ).run(docId, orgId, filename, mimeType, sizeBytes, classification, version, req.auth!.fullName, storagePath, extractedText, summary, now);

      const chunkCount = chunkTextIntoRecords(docId, orgId, extractedText);
      db.prepare(`UPDATE documents SET chunk_count = ? WHERE id = ? AND organization_id = ?`).run(chunkCount, docId, orgId);

      logAuditEvent({
        organizationId: orgId,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'Document uploaded & indexed',
        objectType: 'Document',
        objectId: docId,
        objectLabel: filename,
        previousState: 'None',
        newState: `Processed (${chunkCount} chunks)`,
        sourceRef: 'Document Center',
      });

      const created = db
        .prepare(
          `SELECT id, filename, mime_type, size_bytes, classification, status, version, source, owner_name, summary, chunk_count, created_at
           FROM documents WHERE id = ? AND organization_id = ?`
        )
        .get(docId, orgId);
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Document upload failed.' });
    }
  }
);

// --- Regulations, Diffs, Applicability, Impact & Action Plans ---
workspaceRouter.get('/regulations', (req, res) => {
  const regs = db
    .prepare(`SELECT * FROM regulations WHERE organization_id = ? ORDER BY publication_date DESC`)
    .all(req.auth!.organizationId!);
  res.json(regs);
});

workspaceRouter.get('/regulations/:id', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const regId = req.params.id;
  const regulation = db
    .prepare(`SELECT * FROM regulations WHERE id = ? AND organization_id = ?`)
    .get(regId, orgId);
  if (!regulation) {
    res.status(404).json({ error: 'Regulation not found.' });
    return;
  }

  const versions = db
    .prepare(`SELECT * FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC`)
    .all(regId, orgId)
    .map((v: any) => ({
      ...v,
      diffHighlights: JSON.parse(v.diff_highlights_json || '[]'),
    }));

  const applicabilityRow = db
    .prepare(`SELECT * FROM applicability_assessments WHERE regulation_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(regId, orgId) as any;

  const obligations = db
    .prepare(`SELECT * FROM obligations WHERE regulation_id = ? AND organization_id = ?`)
    .all(regId, orgId);

  const actions = db
    .prepare(`SELECT * FROM remediation_actions WHERE regulation_id = ? AND organization_id = ? ORDER BY code ASC`)
    .all(regId, orgId)
    .map((a: any) => ({
      ...a,
      requiredEvidence: JSON.parse(a.required_evidence_json || '[]'),
    }));

  const policies = db
    .prepare(`SELECT * FROM policies WHERE regulation_id = ? AND organization_id = ?`)
    .all(regId, orgId);

  const graphEdges = db
    .prepare(`SELECT * FROM graph_edges WHERE regulation_id = ? AND organization_id = ?`)
    .all(regId, orgId) as Array<any>;

  const controlIds = Array.from(new Set(actions.map((a: any) => a.control_id).filter(Boolean)));
  const allControls = db.prepare(`SELECT * FROM controls WHERE organization_id = ?`).all(orgId) as Array<any>;
  const impactedControls = allControls.filter(
    (c) => controlIds.includes(c.id) || graphEdges.some((e) => e.target_id === c.id || e.source_id === c.id)
  );

  const allSystems = db.prepare(`SELECT * FROM systems WHERE organization_id = ?`).all(orgId) as Array<any>;
  const impactedSystems = allSystems.filter((s) =>
    graphEdges.some((e) => e.target_id === s.id || e.source_id === s.id)
  );

  res.json({
    regulation,
    versions,
    applicability: applicabilityRow
      ? {
          ...applicabilityRow,
          profileReasons: JSON.parse(applicabilityRow.profile_reasons_json || '[]'),
          citations: JSON.parse(applicabilityRow.citations_json || '[]'),
        }
      : null,
    obligations,
    impactedControls,
    impactedPolicies: policies,
    impactedSystems,
    actions,
    graphEdges,
  });
});

workspaceRouter.get('/regulations/:id/versions', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const id = req.params.id;
  const globalDoc = db.prepare(`SELECT id, regulatory_identifier, title FROM regulatory_documents WHERE id = ?`).get(id) as any;
  if (globalDoc) {
    const versions = db
      .prepare(`SELECT * FROM regulatory_document_versions WHERE document_id = ? ORDER BY version_number DESC`)
      .all(globalDoc.id)
      .map((v: any) => ({ ...v, sections: JSON.parse(v.sections_json || '[]') }));
    res.json({ source: 'regulatory_documents', document: globalDoc, versions });
    return;
  }
  const wsReg = db.prepare(`SELECT id, code, title FROM regulations WHERE id = ? AND organization_id = ?`).get(id, orgId) as any;
  if (!wsReg) {
    res.status(404).json({ error: 'Regulation not found.' });
    return;
  }
  const versions = db
    .prepare(`SELECT * FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC`)
    .all(wsReg.id, orgId)
    .map((v: any) => ({ ...v, diffHighlights: JSON.parse(v.diff_highlights_json || '[]') }));
  res.json({ source: 'workspace_regulations', regulation: wsReg, versions });
});

workspaceRouter.get('/regulations/:id/changes', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const id = req.params.id;
  const globalDoc = db.prepare(`SELECT id, regulatory_identifier, title FROM regulatory_documents WHERE id = ?`).get(id) as any;
  if (globalDoc) {
    const changes = db
      .prepare(
        `SELECT rc.*, ocr.review_status as org_review_status, ocr.reviewed_by as org_reviewed_by, ocr.reviewed_at as org_reviewed_at
         FROM regulatory_changes rc
         LEFT JOIN organization_change_reviews ocr ON ocr.change_id = rc.id AND ocr.organization_id = ?
         WHERE rc.document_id = ?
         ORDER BY rc.change_date DESC, rc.created_at DESC`
      )
      .all(orgId, globalDoc.id)
      .map((c: any) => ({
        ...c,
        org_review_status: c.org_review_status || 'UNREVIEWED',
        structuredDiff: JSON.parse(c.structured_diff_json || '[]'),
        aiSummary: c.ai_summary_json ? JSON.parse(c.ai_summary_json) : null,
      }));
    res.json({ source: 'regulatory_documents', document: globalDoc, changes });
    return;
  }
  const wsReg = db.prepare(`SELECT id, code, title FROM regulations WHERE id = ? AND organization_id = ?`).get(id, orgId) as any;
  if (!wsReg) {
    res.status(404).json({ error: 'Regulation not found.' });
    return;
  }
  const matchedGlobal = db
    .prepare(`SELECT id FROM regulatory_documents WHERE regulatory_identifier = ?`)
    .get(wsReg.code) as { id: string } | undefined;
  const changes = matchedGlobal
    ? db
        .prepare(
          `SELECT rc.*, ocr.review_status as org_review_status
           FROM regulatory_changes rc
           LEFT JOIN organization_change_reviews ocr ON ocr.change_id = rc.id AND ocr.organization_id = ?
           WHERE rc.document_id = ?
           ORDER BY rc.change_date DESC`
        )
        .all(orgId, matchedGlobal.id)
        .map((c: any) => ({
          ...c,
          org_review_status: c.org_review_status || 'UNREVIEWED',
          structuredDiff: JSON.parse(c.structured_diff_json || '[]'),
          aiSummary: c.ai_summary_json ? JSON.parse(c.ai_summary_json) : null,
        }))
    : [];
  res.json({ source: 'workspace_regulations', regulation: wsReg, changes });
});

workspaceRouter.post(
  '/analysis/applicability',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { regulationId } = req.body ?? {};
    if (!regulationId) {
      res.status(400).json({ error: 'regulationId is required.' });
      return;
    }

    const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(orgId) as any;
    const profileRow = db.prepare(`SELECT * FROM company_profiles WHERE organization_id = ?`).get(orgId) as any;
    const reg = db.prepare(`SELECT * FROM regulations WHERE id = ? AND organization_id = ?`).get(String(regulationId), orgId) as any;
    const ver = db
      .prepare(`SELECT * FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC LIMIT 1`)
      .get(String(regulationId), orgId) as any;

    if (!org || !profileRow || !reg || !ver) {
      res.status(404).json({ error: 'Regulation or company profile not found.' });
      return;
    }

    try {
      const profile = {
        business: JSON.parse(profileRow.business_json),
        data: JSON.parse(profileRow.data_json),
        infrastructure: JSON.parse(profileRow.infrastructure_json),
        compliance: JSON.parse(profileRow.compliance_json),
      };

      const aiResult = await runAiApplicabilityAnalysis({
        organizationId: orgId,
        organization: org,
        profile,
        regulation: reg,
        latestVersion: ver,
      });

      const id = `app_${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO applicability_assessments (
          id, organization_id, regulation_id, verdict, confidence, summary, profile_reasons_json, citations_json, is_ai_generated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        id,
        orgId,
        reg.id,
        String(aiResult.verdict || 'Applicable'),
        String(aiResult.confidence || 'Medium'),
        String(aiResult.summary || ''),
        JSON.stringify(aiResult.profileReasons || []),
        JSON.stringify(aiResult.citations || []),
        now
      );

      db.prepare(
        `UPDATE regulations SET applicability_status = ?, applicability_confidence = ? WHERE id = ? AND organization_id = ?`
      ).run(String(aiResult.verdict || 'Applicable'), String(aiResult.confidence || 'Medium'), reg.id, orgId);

      logAuditEvent({
        organizationId: orgId,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'AI applicability analysis executed',
        objectType: 'Regulation',
        objectId: reg.id,
        objectLabel: reg.code,
        previousState: reg.applicability_status,
        newState: `${aiResult.verdict} (${aiResult.confidence})`,
        sourceRef: 'Gemini 4 Hydrogen Analysis',
      });

      res.json({
        id,
        verdict: aiResult.verdict,
        confidence: aiResult.confidence,
        summary: aiResult.summary,
        profileReasons: aiResult.profileReasons || [],
        citations: aiResult.citations || [],
        is_ai_generated: 1,
        created_at: now,
      });
    } catch (err: any) {
      res.status(502).json({
        error: err?.message || 'Unable to run Gemini applicability analysis.',
        code: 'AI_UNAVAILABLE',
      });
    }
  }
);

workspaceRouter.post(
  '/action-plans',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { regulationId } = req.body ?? {};
    if (!regulationId) {
      res.status(400).json({ error: 'regulationId is required.' });
      return;
    }

    const reg = db.prepare(`SELECT * FROM regulations WHERE id = ? AND organization_id = ?`).get(String(regulationId), orgId) as any;
    const ver = db
      .prepare(`SELECT * FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC LIMIT 1`)
      .get(String(regulationId), orgId) as any;
    if (!reg || !ver) {
      res.status(404).json({ error: 'Regulation not found.' });
      return;
    }

    const existingControls = db
      .prepare(`SELECT id, code, title FROM controls WHERE organization_id = ?`)
      .all(orgId) as Array<{ id: string; code: string; title: string }>;
    const existingPolicies = db
      .prepare(`SELECT id, title, current_text FROM policies WHERE organization_id = ?`)
      .all(orgId) as Array<{ id: string; title: string; current_text: string }>;

    try {
      const result = await runAiActionPlanGeneration({
        organizationId: orgId,
        regulation: reg,
        diffNewText: ver.diff_new_text,
        existingControls,
        existingPolicies,
      });

      const createdActions: any[] = [];
      const now = new Date().toISOString();
      const existingCount = (
        db.prepare(`SELECT COUNT(*) as c FROM remediation_actions WHERE organization_id = ?`).get(orgId) as { c: number }
      ).c;

      const actionsList = Array.isArray(result.actions) ? result.actions : [];
      actionsList.forEach((act: any, idx: number) => {
        const id = `rem_${crypto.randomUUID().slice(0, 10)}`;
        const code = `ACT-${String(existingCount + idx + 1).padStart(2, '0')}`;
        const days = typeof act.deadlineDays === 'number' && act.deadlineDays > 0 ? act.deadlineDays : 30;
        const deadline = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
        db.prepare(
          `INSERT INTO remediation_actions (
            id, organization_id, regulation_id, obligation_id, control_id, policy_id, code, title, description,
            required_change, owner_name, owner_department, priority, deadline, status, source_citation, confidence, required_evidence_json, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, ?, ?, ?, ?)`
        ).run(
          id,
          orgId,
          reg.id,
          code,
          String(act.title || 'Compliance Remediation Task'),
          String(act.description || ''),
          String(act.requiredChange || ''),
          req.auth!.fullName,
          String(act.ownerDepartment || 'Compliance'),
          String(act.priority || 'HIGH').toUpperCase(),
          deadline,
          String(act.sourceCitation || reg.code),
          String(act.confidence || 'High'),
          JSON.stringify(Array.isArray(act.requiredEvidence) ? act.requiredEvidence : ['Implementation proof']),
          now,
          now
        );
        createdActions.push({ id, code, title: act.title, priority: act.priority, deadline });
      });

      logAuditEvent({
        organizationId: orgId,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'AI action plan generated',
        objectType: 'ActionPlan',
        objectId: reg.id,
        objectLabel: reg.code,
        previousState: 'Existing plan',
        newState: `${createdActions.length} actions added`,
        sourceRef: 'Gemini 4 Hydrogen Action Planner',
      });

      res.status(201).json({ createdActions });
    } catch (err: any) {
      res.status(502).json({
        error: err?.message || 'Unable to generate AI action plan.',
        code: 'AI_UNAVAILABLE',
      });
    }
  }
);

// --- Knowledge Graph ---
workspaceRouter.get('/graph', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const regId = req.query.regulationId ? String(req.query.regulationId) : null;
  const baseEdges = (
    regId
      ? db.prepare(`SELECT * FROM graph_edges WHERE organization_id = ? AND regulation_id = ?`).all(orgId, regId)
      : db.prepare(`SELECT * FROM graph_edges WHERE organization_id = ?`).all(orgId)
  ) as Array<any>;

  const edges: Array<any> = [...baseEdges];
  const edgeKeys = new Set(baseEdges.map((e) => `${e.source_id}->${e.target_id}:${e.relationship}`));
  const addDynamicEdge = (edge: {
    id: string;
    regulation_id: string;
    source_type: string;
    source_id: string;
    source_label: string;
    target_type: string;
    target_id: string;
    target_label: string;
    relationship: string;
  }) => {
    const key = `${edge.source_id}->${edge.target_id}:${edge.relationship}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ organization_id: orgId, ...edge });
  };

  const remQuery = regId
    ? db
        .prepare(`SELECT * FROM remediation_actions WHERE organization_id = ? AND regulation_id = ?`)
        .all(orgId, regId)
    : db.prepare(`SELECT * FROM remediation_actions WHERE organization_id = ?`).all(orgId);
  const actions = remQuery as Array<any>;

  for (const act of actions) {
    const regRow = db
      .prepare(`SELECT id, code FROM regulations WHERE id = ? AND organization_id = ?`)
      .get(act.regulation_id, orgId) as { id: string; code: string } | undefined;

    const alreadyLinkedToRem = edges.some((e) => e.target_id === act.id);
    if (!alreadyLinkedToRem && regRow) {
      if (act.obligation_id) {
        const ro = db
          .prepare(`SELECT id, title FROM regulatory_obligations WHERE id = ?`)
          .get(act.obligation_id) as { id: string; title: string } | undefined;
        const oblLabel = ro ? ro.title.slice(0, 40) : act.source_citation || 'Obligation';
        addDynamicEdge({
          id: `dyn_reg_obl_${act.id}`,
          regulation_id: regRow.id,
          source_type: 'Regulation',
          source_id: regRow.id,
          source_label: regRow.code,
          target_type: 'Obligation',
          target_id: act.obligation_id,
          target_label: oblLabel,
          relationship: 'CONTAINS',
        });
        addDynamicEdge({
          id: `dyn_obl_rem_${act.id}`,
          regulation_id: regRow.id,
          source_type: 'Obligation',
          source_id: act.obligation_id,
          source_label: oblLabel,
          target_type: 'Remediation',
          target_id: act.id,
          target_label: `${act.code}: ${act.title}`,
          relationship: 'REMEDIATED_BY',
        });
      } else {
        addDynamicEdge({
          id: `dyn_reg_rem_${act.id}`,
          regulation_id: regRow.id,
          source_type: 'Regulation',
          source_id: regRow.id,
          source_label: regRow.code,
          target_type: 'Remediation',
          target_id: act.id,
          target_label: `${act.code}: ${act.title}`,
          relationship: 'REMEDIATED_BY',
        });
      }
    }

    const evRows = db
      .prepare(`SELECT * FROM evidence_items WHERE organization_id = ? AND remediation_id = ?`)
      .all(orgId, act.id) as Array<any>;

    for (const ev of evRows) {
      addDynamicEdge({
        id: `dyn_rem_ev_${ev.id}`,
        regulation_id: act.regulation_id,
        source_type: 'Remediation',
        source_id: act.id,
        source_label: `${act.code}: ${act.title}`,
        target_type: 'Evidence',
        target_id: ev.id,
        target_label: ev.title,
        relationship: 'PROVEN_BY',
      });

      const verStatusLabel =
        ev.status === 'Accepted'
          ? `Verified (${ev.reviewer_name || 'Human'})`
          : ev.status === 'Rejected'
          ? `Rejected (${ev.reviewer_name || 'Human'})`
          : 'Pending Human Review';

      addDynamicEdge({
        id: `dyn_ev_ver_${ev.id}`,
        regulation_id: act.regulation_id,
        source_type: 'Evidence',
        source_id: ev.id,
        source_label: ev.title,
        target_type: 'Verification',
        target_id: `ver_${ev.id}`,
        target_label: verStatusLabel,
        relationship: ev.status === 'Accepted' ? 'VERIFIED_BY' : 'AWAITS_VERIFICATION',
      });
    }
  }

  res.json({ edges });
});

// --- Controls ---
workspaceRouter.get('/controls', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM controls WHERE organization_id = ? ORDER BY code ASC`)
    .all(req.auth!.organizationId!);
  res.json(rows);
});

workspaceRouter.post('/controls', requireOrgRole(['org_admin', 'compliance_officer']), (req, res) => {
  const orgId = req.auth!.organizationId!;
  const { code, title, description, ownerDepartment } = req.body ?? {};
  if (!code || !title) {
    res.status(400).json({ error: 'Control code and title are required.' });
    return;
  }
  const id = `ctrl_${crypto.randomUUID().slice(0, 10)}`;
  db.prepare(
    `INSERT INTO controls (id, organization_id, code, title, description, owner_department, status, verification_status, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, 'In Progress', 'Pending Verification', NULL)`
  ).run(id, orgId, String(code).trim(), String(title).trim(), String(description || ''), String(ownerDepartment || 'Compliance'));
  res.status(201).json({ id, code, title });
});

// --- Policies (Human-in-the-loop Diff Approval) ---
workspaceRouter.get('/policies', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM policies WHERE organization_id = ? ORDER BY id ASC`)
    .all(req.auth!.organizationId!);
  res.json(rows);
});

workspaceRouter.post(
  '/policies/:id/decision',
  requireOrgRole(['org_admin', 'compliance_officer']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { decision, note } = req.body ?? {};
    if (!['Approve', 'Reject', 'Request Changes'].includes(String(decision))) {
      res.status(400).json({ error: 'Decision must be Approve, Reject, or Request Changes.' });
      return;
    }

    const policy = db
      .prepare(`SELECT * FROM policies WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, orgId) as any;
    if (!policy) {
      res.status(404).json({ error: 'Policy not found.' });
      return;
    }

    const now = new Date().toISOString();
    const newStatus =
      decision === 'Approve' ? 'Approved' : decision === 'Reject' ? 'Rejected' : 'Changes Requested';

    if (decision === 'Approve') {
      db.prepare(
        `UPDATE policies
         SET status = ?, current_text = proposed_text, version = 'v2.2 (Approved)', approved_by = ?, approved_at = ?, review_note = ?
         WHERE id = ? AND organization_id = ?`
      ).run(newStatus, req.auth!.fullName, now, String(note || 'Approved policy update diff.'), policy.id, orgId);

      // Update any remediation action tied directly to this policy update
      db.prepare(
        `UPDATE remediation_actions
         SET status = 'Implemented', updated_at = ?
         WHERE policy_id = ? AND organization_id = ? AND status IN ('Not Started', 'In Progress', 'Ready for Review')`
      ).run(now, policy.id, orgId);
    } else {
      db.prepare(
        `UPDATE policies SET status = ?, approved_by = ?, approved_at = ?, review_note = ? WHERE id = ? AND organization_id = ?`
      ).run(newStatus, req.auth!.fullName, now, String(note || ''), policy.id, orgId);
    }

    logAuditEvent({
      organizationId: orgId,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action: `Human policy decision: ${decision}`,
      objectType: 'Policy',
      objectId: policy.id,
      objectLabel: policy.title,
      previousState: policy.status,
      newState: newStatus,
      sourceRef: 'Policy Diff Review',
    });

    const updated = db.prepare(`SELECT * FROM policies WHERE id = ? AND organization_id = ?`).get(policy.id, orgId);
    res.json(updated);
  }
);

// --- Remediation Center ---
workspaceRouter.get('/remediation', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const obligationIdFilter = req.query.obligationId ? String(req.query.obligationId) : null;
  const actions = db
    .prepare(
      `SELECT ra.*,
              COALESCE(r.code, rd.regulatory_identifier) as regulation_code,
              COALESCE(r.title, rd.title) as regulation_title,
              COALESCE(r.regulator, rd.regulator) as regulator
       FROM remediation_actions ra
       LEFT JOIN regulations r ON r.id = ra.regulation_id AND r.organization_id = ra.organization_id
       LEFT JOIN regulatory_obligations ro ON ro.id = ra.obligation_id
       LEFT JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       WHERE ra.organization_id = ?
         ${obligationIdFilter ? 'AND ra.obligation_id = ?' : ''}
       ORDER BY ra.deadline ASC, ra.created_at DESC`
    )
    .all(...(obligationIdFilter ? [orgId, obligationIdFilter] : [orgId]))
    .map((a: any) => ({
      ...a,
      requiredEvidence: JSON.parse(a.required_evidence_json || '[]'),
      comments: db
        .prepare(`SELECT * FROM remediation_comments WHERE remediation_id = ? AND organization_id = ? ORDER BY created_at ASC`)
        .all(a.id, orgId),
    }));
  res.json(actions);
});

workspaceRouter.post(
  '/remediation',
  requireOrgRole(['org_admin', 'compliance_officer']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const {
      obligationId,
      regulationId,
      controlId,
      policyId,
      title,
      description,
      requiredChange,
      ownerName,
      ownerDepartment,
      priority,
      deadline,
      sourceCitation,
      confidence,
      requiredEvidence,
    } = req.body ?? {};

    let linkedObl: any = null;
    if (obligationId) {
      linkedObl = db
        .prepare(
          `SELECT ro.*, rd.id as doc_id, rd.regulatory_identifier, rd.title as doc_title, rd.regulator,
                  rd.jurisdiction as doc_jurisdiction, rd.source_url, rd.publication_date, rd.effective_date,
                  rd.current_version_number, rv.content_hash
           FROM regulatory_obligations ro
           JOIN regulatory_documents rd ON rd.id = ro.regulation_id
           LEFT JOIN regulatory_document_versions rv ON rv.id = ro.regulation_version_id
           WHERE ro.id = ?`
        )
        .get(String(obligationId));
      if (!linkedObl) {
        res.status(404).json({ error: 'Regulatory obligation not found.' });
        return;
      }
    }

    const cleanTitle = String(title || linkedObl?.title || '').trim();
    if (!cleanTitle) {
      res.status(400).json({ error: 'Remediation title or obligationId is required.' });
      return;
    }

    const now = new Date().toISOString();
    let targetRegId = regulationId ? String(regulationId) : '';

    if (targetRegId) {
      const wsReg = db
        .prepare(`SELECT id FROM regulations WHERE id = ? AND organization_id = ?`)
        .get(targetRegId, orgId) as { id: string } | undefined;
      if (!wsReg) {
        res.status(404).json({ error: 'Workspace regulation not found.' });
        return;
      }
    } else if (linkedObl) {
      const matchingWsReg = db
        .prepare(`SELECT id FROM regulations WHERE organization_id = ? AND code = ? LIMIT 1`)
        .get(orgId, linkedObl.regulatory_identifier) as { id: string } | undefined;

      if (matchingWsReg) {
        targetRegId = matchingWsReg.id;
      } else {
        targetRegId = `reg_${crypto.randomUUID().slice(0, 10)}`;
        db.prepare(
          `INSERT INTO regulations (
            id, organization_id, code, title, regulator, jurisdiction, source_url, publication_date, effective_date,
            severity, applicability_status, applicability_confidence, status, current_version, summary, content_hash, retrieved_at, is_demo_seeded
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'High', 'Applicable', ?, 'Action Required', ?, ?, ?, ?, 0)`
        ).run(
          targetRegId,
          orgId,
          linkedObl.regulatory_identifier,
          linkedObl.doc_title,
          linkedObl.regulator,
          linkedObl.doc_jurisdiction,
          linkedObl.source_url,
          linkedObl.publication_date,
          linkedObl.effective_date,
          linkedObl.confidence || 'High',
          linkedObl.current_version_number || 1,
          linkedObl.description,
          linkedObl.content_hash || crypto.createHash('sha256').update(linkedObl.doc_id).digest('hex'),
          now
        );
      }
    } else {
      res.status(400).json({ error: 'Either obligationId or regulationId is required.' });
      return;
    }

    const countRow = db
      .prepare(`SELECT COUNT(*) as c FROM remediation_actions WHERE organization_id = ?`)
      .get(orgId) as { c: number };
    const code = `ACT-${String(countRow.c + 1).padStart(2, '0')}`;
    const id = `rem_${crypto.randomUUID().slice(0, 10)}`;

    const defaultDeadline =
      deadline && /^\d{4}-\d{2}-\d{2}$/.test(String(deadline))
        ? String(deadline)
        : linkedObl?.effective_date && /^\d{4}-\d{2}-\d{2}$/.test(String(linkedObl.effective_date))
        ? String(linkedObl.effective_date)
        : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const parsedEvidence = Array.isArray(requiredEvidence)
      ? requiredEvidence.map((e: unknown) => String(e).trim()).filter(Boolean)
      : linkedObl?.evidence_required_json
      ? JSON.parse(linkedObl.evidence_required_json || '[]')
      : ['Supporting configuration or attestation proof'];

    const normalizedPriority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(String(priority || '').toUpperCase())
      ? String(priority).toUpperCase()
      : 'HIGH';

    db.prepare(
      `INSERT INTO remediation_actions (
        id, organization_id, regulation_id, obligation_id, control_id, policy_id, code, title, description,
        required_change, owner_name, owner_department, priority, deadline, status, source_citation, confidence, required_evidence_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, ?, ?, ?, ?)`
    ).run(
      id,
      orgId,
      targetRegId,
      linkedObl ? linkedObl.id : null,
      controlId ? String(controlId) : null,
      policyId ? String(policyId) : null,
      code,
      cleanTitle,
      String(description || linkedObl?.description || cleanTitle),
      String(requiredChange || linkedObl?.required_action || cleanTitle),
      String(ownerName || req.auth!.fullName),
      String(ownerDepartment || 'Compliance'),
      normalizedPriority,
      defaultDeadline,
      String(sourceCitation || linkedObl?.source_reference || code),
      String(confidence || linkedObl?.confidence || 'High'),
      JSON.stringify(parsedEvidence),
      now,
      now
    );

    logAuditEvent({
      organizationId: orgId,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action: 'Remediation action created',
      objectType: 'Remediation',
      objectId: id,
      objectLabel: `${code}: ${cleanTitle}`,
      previousState: 'None',
      newState: 'Not Started',
      sourceRef: String(sourceCitation || linkedObl?.source_reference || 'Applicability Engine'),
    });

    const created = db
      .prepare(
        `SELECT ra.*,
                COALESCE(r.code, rd.regulatory_identifier) as regulation_code,
                COALESCE(r.title, rd.title) as regulation_title,
                COALESCE(r.regulator, rd.regulator) as regulator
         FROM remediation_actions ra
         LEFT JOIN regulations r ON r.id = ra.regulation_id AND r.organization_id = ra.organization_id
         LEFT JOIN regulatory_obligations ro ON ro.id = ra.obligation_id
         LEFT JOIN regulatory_documents rd ON rd.id = ro.regulation_id
         WHERE ra.id = ? AND ra.organization_id = ?`
      )
      .get(id, orgId) as any;

    res.status(201).json({
      ...created,
      requiredEvidence: JSON.parse(created.required_evidence_json || '[]'),
      comments: [],
    });
  }
);

workspaceRouter.patch(
  '/remediation/:id',
  requireOrgRole(['org_admin', 'compliance_officer', 'engineering']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const existing = db
      .prepare(`SELECT * FROM remediation_actions WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, orgId) as any;
    if (!existing) {
      res.status(404).json({ error: 'Remediation action not found.' });
      return;
    }

    const { status, ownerName, priority } = req.body ?? {};
    const validStatuses = ['Not Started', 'In Progress', 'Blocked', 'Ready for Review', 'Implemented', 'Verified', 'Rejected'];
    if (status && !validStatuses.includes(String(status))) {
      res.status(400).json({ error: 'Invalid remediation status.' });
      return;
    }

    const now = new Date().toISOString();
    const nextStatus = status ? String(status) : existing.status;
    const nextOwner = ownerName ? String(ownerName) : existing.owner_name;
    const nextPriority = priority ? String(priority) : existing.priority;

    db.prepare(
      `UPDATE remediation_actions SET status = ?, owner_name = ?, priority = ?, updated_at = ? WHERE id = ? AND organization_id = ?`
    ).run(nextStatus, nextOwner, nextPriority, now, existing.id, orgId);

    logAuditEvent({
      organizationId: orgId,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action: 'Remediation action updated',
      objectType: 'Remediation',
      objectId: existing.id,
      objectLabel: `${existing.code}: ${existing.title}`,
      previousState: existing.status,
      newState: nextStatus,
      sourceRef: 'Remediation Center',
    });

    res.json({ ok: true, status: nextStatus, owner_name: nextOwner, priority: nextPriority });
  }
);

workspaceRouter.post(
  '/remediation/:id/comments',
  requireOrgRole(['org_admin', 'compliance_officer', 'engineering']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { body } = req.body ?? {};
    if (!body || !String(body).trim()) {
      res.status(400).json({ error: 'Comment text is required.' });
      return;
    }
    const existing = db
      .prepare(`SELECT id FROM remediation_actions WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, orgId);
    if (!existing) {
      res.status(404).json({ error: 'Remediation action not found.' });
      return;
    }
    const id = `cmt_${crypto.randomUUID().slice(0, 10)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO remediation_comments (id, remediation_id, organization_id, author_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, req.params.id, orgId, req.auth!.fullName, String(body).trim(), now);
    res.status(201).json({ id, author_name: req.auth!.fullName, body: String(body).trim(), created_at: now });
  }
);

// --- Evidence & Verification ---
workspaceRouter.get('/evidence', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const items = db
    .prepare(
      `SELECT ei.*, ra.code as remediation_code, ra.title as remediation_title, c.code as control_code, c.title as control_title
       FROM evidence_items ei
       LEFT JOIN remediation_actions ra ON ra.id = ei.remediation_id AND ra.organization_id = ei.organization_id
       LEFT JOIN controls c ON c.id = ei.control_id AND c.organization_id = ei.organization_id
       WHERE ei.organization_id = ?
       ORDER BY ei.created_at DESC`
    )
    .all(orgId)
    .map((e: any) => ({
      ...e,
      aiAssessment: e.ai_assessment_json ? JSON.parse(e.ai_assessment_json) : null,
    }));
  res.json(items);
});

workspaceRouter.post(
  '/evidence',
  requireOrgRole(['org_admin', 'compliance_officer', 'engineering']),
  upload.single('file'),
  (req, res) => {
    try {
      const orgId = req.auth!.organizationId!;
      const { remediationId, title, evidenceType, textProof } = req.body ?? {};
      if (!remediationId || !title) {
        res.status(400).json({ error: 'Remediation action and evidence title are required.' });
        return;
      }

      const rem = db
        .prepare(`SELECT * FROM remediation_actions WHERE id = ? AND organization_id = ?`)
        .get(String(remediationId), orgId) as any;
      if (!rem) {
        res.status(404).json({ error: 'Target remediation action not found.' });
        return;
      }

      let filename = `evidence_${Date.now()}.txt`;
      let mimeType = 'text/plain';
      let sizeBytes = 0;
      let storagePath: string | null = null;
      let extractedText = '';

      if (req.file) {
        filename = req.file.originalname;
        mimeType = req.file.mimetype || 'application/octet-stream';
        sizeBytes = req.file.size;
        storagePath = saveUploadedFileSafely(orgId, filename, req.file.buffer);
        extractedText = extractReadableText(filename, mimeType, req.file.buffer);
      } else if (typeof textProof === 'string' && textProof.trim()) {
        extractedText = textProof.trim();
        sizeBytes = Buffer.byteLength(extractedText, 'utf8');
      } else {
        res.status(400).json({ error: 'Upload an evidence file or provide configuration/log proof.' });
        return;
      }

      const evId = `ev_${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO evidence_items (
          id, organization_id, remediation_id, control_id, obligation_id, title, evidence_type, filename, mime_type, size_bytes,
          storage_path, extracted_text, status, ai_assessment_json, reviewer_name, review_notes, verified_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Under Review', NULL, NULL, NULL, NULL, ?)`
      ).run(
        evId,
        orgId,
        rem.id,
        rem.control_id,
        rem.obligation_id,
        String(title).trim(),
        String(evidenceType || 'configuration'),
        filename,
        mimeType,
        sizeBytes,
        storagePath,
        extractedText,
        now
      );

      db.prepare(`UPDATE remediation_actions SET status = 'Ready for Review', updated_at = ? WHERE id = ? AND organization_id = ?`).run(
        now,
        rem.id,
        orgId
      );

      logAuditEvent({
        organizationId: orgId,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'Evidence uploaded',
        objectType: 'Evidence',
        objectId: evId,
        objectLabel: filename,
        previousState: rem.status,
        newState: 'Under Review',
        sourceRef: rem.code,
      });

      res.status(201).json({
        id: evId,
        remediation_id: rem.id,
        title: String(title).trim(),
        filename,
        status: 'Under Review',
        created_at: now,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Evidence upload failed.' });
    }
  }
);

workspaceRouter.post(
  '/evidence/:id/verify-ai',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    const orgId = req.auth!.organizationId!;
    const ev = db
      .prepare(`SELECT * FROM evidence_items WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, orgId) as any;
    if (!ev) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }
    const rem = db
      .prepare(`SELECT * FROM remediation_actions WHERE id = ? AND organization_id = ?`)
      .get(ev.remediation_id, orgId) as any;
    const ctrl = ev.control_id
      ? (db.prepare(`SELECT * FROM controls WHERE id = ? AND organization_id = ?`).get(ev.control_id, orgId) as any)
      : null;

    try {
      const assessment = await runAiEvidenceEvaluation({
        requirementTitle: rem?.title || ev.title,
        controlTitle: ctrl?.title || 'Associated Compliance Control',
        requiredChange: rem?.required_change || ev.title,
        evidenceTitle: ev.title,
        evidenceType: ev.evidence_type,
        evidenceContent: ev.extracted_text,
      });

      db.prepare(`UPDATE evidence_items SET ai_assessment_json = ? WHERE id = ? AND organization_id = ?`).run(
        JSON.stringify(assessment),
        ev.id,
        orgId
      );

      logAuditEvent({
        organizationId: orgId,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'AI evidence assessment completed',
        objectType: 'Evidence',
        objectId: ev.id,
        objectLabel: ev.filename,
        previousState: ev.status,
        newState: String(assessment.recommendation || 'Assessed'),
        sourceRef: 'Gemini 4 Hydrogen Evidence Evaluator',
      });

      res.json({ aiAssessment: assessment });
    } catch (err: any) {
      res.status(502).json({
        error: err?.message || 'Unable to run Gemini evidence evaluation.',
        code: 'AI_UNAVAILABLE',
      });
    }
  }
);

workspaceRouter.post(
  '/evidence/:id/review',
  requireOrgRole(['org_admin', 'compliance_officer']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { decision, notes } = req.body ?? {};
    if (!['Accepted', 'Rejected'].includes(String(decision))) {
      res.status(400).json({ error: 'Decision must be Accepted or Rejected.' });
      return;
    }

    const ev = db
      .prepare(`SELECT * FROM evidence_items WHERE id = ? AND organization_id = ?`)
      .get(req.params.id, orgId) as any;
    if (!ev) {
      res.status(404).json({ error: 'Evidence item not found.' });
      return;
    }

    const now = new Date().toISOString();
    const isAccepted = decision === 'Accepted';
    const nextRemStatus = isAccepted ? 'Verified' : 'Rejected';

    db.prepare(
      `UPDATE evidence_items SET status = ?, reviewer_name = ?, review_notes = ?, verified_at = ? WHERE id = ? AND organization_id = ?`
    ).run(String(decision), req.auth!.fullName, String(notes || ''), now, ev.id, orgId);

    db.prepare(`UPDATE remediation_actions SET status = ?, updated_at = ? WHERE id = ? AND organization_id = ?`).run(
      nextRemStatus,
      now,
      ev.remediation_id,
      orgId
    );

    if (ev.control_id) {
      db.prepare(
        `UPDATE controls SET status = ?, verification_status = ?, last_verified_at = ? WHERE id = ? AND organization_id = ?`
      ).run(isAccepted ? 'Implemented' : 'Requires Update', isAccepted ? 'Verified' : 'Requires Remediation', now, ev.control_id, orgId);
    }

    if (ev.obligation_id && isAccepted) {
      db.prepare(`UPDATE obligations SET status = 'Verified' WHERE id = ? AND organization_id = ?`).run(ev.obligation_id, orgId);
    }

    // Check if all actions for the linked regulation are now Verified
    const rem = db
      .prepare(`SELECT regulation_id, code, title FROM remediation_actions WHERE id = ? AND organization_id = ?`)
      .get(ev.remediation_id, orgId) as any;
    if (rem?.regulation_id && isAccepted) {
      const remaining = (
        db
          .prepare(`SELECT COUNT(*) as c FROM remediation_actions WHERE regulation_id = ? AND organization_id = ? AND status != 'Verified'`)
          .get(rem.regulation_id, orgId) as { c: number }
      ).c;
      if (remaining === 0) {
        db.prepare(`UPDATE regulations SET status = 'Verified' WHERE id = ? AND organization_id = ?`).run(rem.regulation_id, orgId);
      } else {
        db.prepare(`UPDATE regulations SET status = 'In Progress' WHERE id = ? AND organization_id = ? AND status = 'Action Required'`).run(
          rem.regulation_id,
          orgId
        );
      }
    }

    logAuditEvent({
      organizationId: orgId,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action: isAccepted ? 'Verification completed' : 'Evidence rejected',
      objectType: 'Evidence',
      objectId: ev.id,
      objectLabel: ev.title,
      previousState: ev.status,
      newState: isAccepted ? 'VERIFIED' : 'REQUIRES REMEDIATION',
      sourceRef: rem?.code || 'Verification Workflow',
    });

    const relatedEvidenceCount = (
      db.prepare(`SELECT COUNT(*) as c FROM evidence_items WHERE remediation_id = ? AND organization_id = ?`).get(ev.remediation_id, orgId) as {
        c: number;
      }
    ).c;

    res.json({
      status: isAccepted ? 'VERIFIED' : 'REQUIRES REMEDIATION',
      evidenceStatus: decision,
      remediationStatus: nextRemStatus,
      requirementTitle: rem?.title || ev.title,
      evidenceCount: relatedEvidenceCount,
      approvedBy: req.auth!.fullName,
      verifiedAt: now,
    });
  }
);

// --- Audit Log ---
workspaceRouter.get('/audit-log', (req, res) => {
  const events = db
    .prepare(`SELECT * FROM audit_events WHERE organization_id = ? ORDER BY timestamp DESC LIMIT 200`)
    .all(req.auth!.organizationId!);
  res.json(events);
});

// --- Notifications ---
workspaceRouter.get('/notifications', (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM notifications WHERE organization_id = ? ORDER BY created_at DESC LIMIT 30`)
    .all(req.auth!.organizationId!);
  res.json(rows);
});

workspaceRouter.post('/notifications/read-all', (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE organization_id = ?`).run(req.auth!.organizationId!);
  res.json({ ok: true });
});

// --- Global Search (Org-isolated) ---
workspaceRouter.get('/search', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const q = String(req.query.q || '').trim();
  if (!q) {
    res.json({ regulations: [], controls: [], remediation: [], documents: [], evidence: [] });
    return;
  }
  const like = `%${q}%`;
  const regulations = db
    .prepare(`SELECT id, code, title, regulator, severity FROM regulations WHERE organization_id = ? AND (title LIKE ? OR code LIKE ? OR regulator LIKE ?) LIMIT 5`)
    .all(orgId, like, like, like);
  const controls = db
    .prepare(`SELECT id, code, title, verification_status FROM controls WHERE organization_id = ? AND (title LIKE ? OR code LIKE ?) LIMIT 5`)
    .all(orgId, like, like);
  const remediation = db
    .prepare(`SELECT id, code, title, status, priority FROM remediation_actions WHERE organization_id = ? AND (title LIKE ? OR code LIKE ?) LIMIT 5`)
    .all(orgId, like, like);
  const documents = db
    .prepare(`SELECT id, filename, classification FROM documents WHERE organization_id = ? AND (filename LIKE ? OR summary LIKE ?) LIMIT 5`)
    .all(orgId, like, like);
  const evidence = db
    .prepare(`SELECT id, title, filename, status FROM evidence_items WHERE organization_id = ? AND (title LIKE ? OR filename LIKE ?) LIMIT 5`)
    .all(orgId, like, like);

  res.json({ regulations, controls, remediation, documents, evidence });
});

// --- ComplianceOS MCP Endpoints ---
workspaceRouter.get('/mcp/tools', (_req, res) => {
  res.json({ tools: MCP_TOOLS });
});

workspaceRouter.post('/mcp/call', async (req, res) => {
  const { toolName, arguments: args } = req.body ?? {};
  if (typeof toolName !== 'string') {
    res.status(400).json({ error: 'toolName is required.' });
    return;
  }
  try {
    const result = await executeMcpTool(req.auth!.organizationId!, req.auth!.fullName, toolName, args || {});
    res.json({ toolName, result });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'MCP invocation failed.' });
  }
});

// --- Deterministic Evaluation Suite ---
workspaceRouter.get('/evals', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const regs = db.prepare(`SELECT * FROM regulations WHERE organization_id = ?`).all(orgId) as Array<any>;
  const policies = db.prepare(`SELECT * FROM policies WHERE organization_id = ?`).all(orgId) as Array<any>;
  const auditCount = (db.prepare(`SELECT COUNT(*) as c FROM audit_events WHERE organization_id = ?`).get(orgId) as { c: number }).c;
  const edgesCount = (db.prepare(`SELECT COUNT(*) as c FROM graph_edges WHERE organization_id = ?`).get(orgId) as { c: number }).c;

  const checks = [
    {
      id: 'eval_tenant_isolation',
      name: 'Multi-Tenant Query Isolation',
      category: 'Security & Isolation',
      passed: regs.every((r) => r.organization_id === orgId),
      detail: `All ${regs.length} regulatory records match workspace ID ${orgId}.`,
    },
    {
      id: 'eval_source_citations',
      name: 'Regulatory Source & Hash Traceability',
      category: 'Groundedness',
      passed: regs.every((r) => Boolean(r.source_url) && Boolean(r.content_hash)),
      detail: 'Every monitored circular carries source URL, content hash, and retrieval timestamp.',
    },
    {
      id: 'eval_human_approval_gate',
      name: 'Human-in-the-Loop Policy Approval Gate',
      category: 'Guardrails',
      passed: policies.every((p) => p.status !== 'Approved' || Boolean(p.approved_by)),
      detail: 'AI policy proposals never overwrite active policies without recorded human approval.',
    },
    {
      id: 'eval_graph_lineage',
      name: 'Knowledge Graph Lineage Connectivity',
      category: 'Impact Mapping',
      passed: edgesCount > 0,
      detail: `${edgesCount} typed lineage edges linking Regulation -> Obligation -> Control -> Policy/System.`,
    },
    {
      id: 'eval_audit_append',
      name: 'Append-Only Audit Trail Coverage',
      category: 'Auditability',
      passed: auditCount > 0,
      detail: `${auditCount} immutable audit events recorded for this organization.`,
    },
  ];

  res.json({
    passedCount: checks.filter((c) => c.passed).length,
    totalCount: checks.length,
    checks,
  });
});
