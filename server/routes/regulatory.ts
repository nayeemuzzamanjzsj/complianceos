import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.ts';
import { logAuditEvent, requireOrgRole, requireWorkspaceAuth } from '../services/auth.ts';
import { regulatoryGraphStore } from '../services/regulatoryGraph.ts';
import {
  assertSafeExternalUrl,
  checkRegulatorySourceById,
  ingestRegulatoryDocument,
  runLiveAiSummaryForChange,
} from '../services/regulatoryIngestion.ts';

const ALLOWED_INGEST_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.html', '.htm', '.json', '.xml', '.csv']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_INGEST_EXTENSIONS.has(ext)) {
      cb(new Error(`Unsupported regulatory file extension "${ext}".`));
      return;
    }
    cb(null, true);
  },
});

const ALLOWED_SOURCE_TYPES = new Set([
  'government_website',
  'gazette',
  'circular',
  'regulation_database',
  'api',
  'rss_atom',
  'uploaded_document',
]);

export const regulatoryRouter = Router();
regulatoryRouter.use(requireWorkspaceAuth);

// --- Regulatory Sources ---
regulatoryRouter.get('/regulatory-sources', (_req, res) => {
  const sources = db
    .prepare(`SELECT * FROM regulatory_sources ORDER BY active DESC, jurisdiction ASC, name ASC`)
    .all() as Array<any>;
  const recentRuns = db
    .prepare(`SELECT * FROM regulatory_ingestion_runs ORDER BY started_at DESC LIMIT 25`)
    .all()
    .map((r: any) => ({ ...r, events: JSON.parse(r.events_json || '[]') }));
  res.json({ sources, recentRuns });
});

regulatoryRouter.post('/regulatory-sources', requireOrgRole(['org_admin', 'compliance_officer']), (req, res) => {
  const { name, jurisdiction, stateProvince, regulator, sourceType, sourceUrl, description, monitoringFrequency } =
    req.body ?? {};
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    typeof jurisdiction !== 'string' ||
    !jurisdiction.trim() ||
    typeof regulator !== 'string' ||
    !regulator.trim() ||
    typeof sourceUrl !== 'string' ||
    !sourceUrl.trim()
  ) {
    res.status(400).json({ error: 'Name, jurisdiction, regulator, and sourceUrl are required.' });
    return;
  }

  const sType = typeof sourceType === 'string' && ALLOWED_SOURCE_TYPES.has(sourceType) ? sourceType : 'government_website';
  try {
    assertSafeExternalUrl(sourceUrl.trim());
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Invalid regulatory source URL.' });
    return;
  }

  const id = `src_${crypto.randomUUID().slice(0, 10)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO regulatory_sources (
      id, name, jurisdiction, state_province, regulator, source_type, source_url,
      description, active, monitoring_frequency, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`
  ).run(
    id,
    name.trim(),
    jurisdiction.trim(),
    typeof stateProvince === 'string' && stateProvince.trim() ? stateProvince.trim() : null,
    regulator.trim(),
    sType,
    sourceUrl.trim(),
    typeof description === 'string' ? description.trim() : `${regulator.trim()} regulatory feed`,
    typeof monitoringFrequency === 'string' && monitoringFrequency.trim() ? monitoringFrequency.trim() : 'daily',
    now,
    now
  );

  const created = db.prepare(`SELECT * FROM regulatory_sources WHERE id = ?`).get(id);
  res.status(201).json(created);
});

regulatoryRouter.post(
  '/regulatory-sources/:id/check',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    try {
      const outcome = await checkRegulatorySourceById(req.params.id);
      res.json(outcome);
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Regulatory source check failed.' });
    }
  }
);

// --- Regulatory Document Ingestion (New or Updated Version) ---
regulatoryRouter.post(
  '/regulatory-documents/ingest',
  requireOrgRole(['org_admin', 'compliance_officer']),
  upload.single('file'),
  async (req, res) => {
    const body = req.body ?? {};
    const sourceId = typeof body.sourceId === 'string' && body.sourceId.trim() ? body.sourceId.trim() : 'src_bb_psd';
    const regulatoryIdentifier =
      typeof body.regulatoryIdentifier === 'string' ? body.regulatoryIdentifier.trim() : '';
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const jurisdiction = typeof body.jurisdiction === 'string' && body.jurisdiction.trim() ? body.jurisdiction.trim() : 'Bangladesh';
    const regulator = typeof body.regulator === 'string' && body.regulator.trim() ? body.regulator.trim() : 'Bangladesh Bank';
    const sourceUrl =
      typeof body.sourceUrl === 'string' && body.sourceUrl.trim()
        ? body.sourceUrl.trim()
        : 'https://complianceos.internal/uploaded-regulatory-document';

    if (!regulatoryIdentifier || !title) {
      res.status(400).json({ error: 'regulatoryIdentifier and title are required.' });
      return;
    }

    const rawContent: string | Buffer = req.file
      ? req.file.buffer
      : typeof body.content === 'string'
      ? body.content
      : '';

    if (!rawContent || (typeof rawContent === 'string' && !rawContent.trim())) {
      res.status(400).json({ error: 'Provide regulatory document content or upload a supported file.' });
      return;
    }

    const parseJsonList = (val: unknown, fallback: string[]): string[] => {
      if (Array.isArray(val)) return val.map(String);
      if (typeof val === 'string' && val.trim()) {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed.map(String);
        } catch {
          return val.split(',').map((s) => s.trim()).filter(Boolean);
        }
      }
      return fallback;
    };

    const outcome = await ingestRegulatoryDocument({
      sourceId,
      regulatoryIdentifier,
      title,
      jurisdiction,
      country: typeof body.country === 'string' && body.country.trim() ? body.country.trim() : jurisdiction,
      stateProvince: typeof body.stateProvince === 'string' && body.stateProvince.trim() ? body.stateProvince.trim() : null,
      regulator,
      documentType: typeof body.documentType === 'string' && body.documentType.trim() ? body.documentType.trim() : 'Circular',
      publicationDate: typeof body.publicationDate === 'string' ? body.publicationDate.trim() : undefined,
      effectiveDate: typeof body.effectiveDate === 'string' ? body.effectiveDate.trim() : undefined,
      sourceUrl,
      contentType: req.file ? req.file.mimetype : typeof body.contentType === 'string' ? body.contentType : 'text/plain',
      rawContent,
      rawDocumentLocation: req.file ? req.file.originalname : null,
      explicitStatus: typeof body.explicitStatus === 'string' ? body.explicitStatus : undefined,
      industryTags: parseJsonList(body.industryTags, ['Financial Services']),
      companyTypes: parseJsonList(body.companyTypes, ['Regulated Entity']),
      topics: parseJsonList(body.topics, []),
      isDemo: false,
      runAi: body.runAi !== 'false' && body.runAi !== false,
    });

    if (outcome.status === 'FAILED') {
      res.status(422).json(outcome);
      return;
    }

    logAuditEvent({
      organizationId: req.auth!.organizationId!,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action:
        outcome.status === 'UNCHANGED'
          ? 'Regulatory document checked (unchanged)'
          : `Regulatory document ingested (v${outcome.versionNumber})`,
      objectType: 'RegulatoryDocument',
      objectId: outcome.documentId || regulatoryIdentifier,
      objectLabel: `${regulatoryIdentifier} — ${title}`,
      previousState: outcome.versionNumber && outcome.versionNumber > 1 ? `v${outcome.versionNumber - 1}` : 'None',
      newState: `${outcome.changeStatus || outcome.status} (v${outcome.versionNumber || 1})`,
      sourceRef: 'Regulatory Ingestion Engine',
    });

    res.status(outcome.status === 'NEW_VERSION' ? 201 : 200).json(outcome);
  }
);

// --- Search & Browse Global Regulatory Documents ---
regulatoryRouter.get('/regulatory-documents', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const jurisdiction = String(req.query.jurisdiction || '').trim().toLowerCase();
  const regulator = String(req.query.regulator || '').trim().toLowerCase();
  const identifier = String(req.query.identifier || '').trim().toLowerCase();
  const status = String(req.query.status || '').trim().toUpperCase();
  const topic = String(req.query.topic || '').trim().toLowerCase();
  const dateFrom = String(req.query.dateFrom || '').trim();
  const dateTo = String(req.query.dateTo || '').trim();
  const obligationType = String(req.query.obligationType || '').trim().toUpperCase();

  const docs = db
    .prepare(
      `SELECT rd.*, rs.name as source_name, rs.source_type as source_type,
        (SELECT COUNT(*) FROM regulatory_obligations ro WHERE ro.regulation_id = rd.id AND ro.regulation_version_id = rd.current_version_id) as obligation_count,
        (SELECT COUNT(*) FROM regulatory_document_versions rv WHERE rv.document_id = rd.id) as version_count
       FROM regulatory_documents rd
       JOIN regulatory_sources rs ON rs.id = rd.source_id
       ORDER BY rd.publication_date DESC, rd.updated_at DESC`
    )
    .all() as Array<any>;

  const oblDocs = obligationType
    ? new Set(
        (
          db
            .prepare(`SELECT DISTINCT regulation_id FROM regulatory_obligations WHERE obligation_type = ?`)
            .all(obligationType) as Array<{ regulation_id: string }>
        ).map((r) => r.regulation_id)
      )
    : null;

  const filtered = docs
    .map((d) => ({
      ...d,
      industryTags: JSON.parse(d.industry_tags_json || '[]'),
      companyTypes: JSON.parse(d.company_types_json || '[]'),
      topics: JSON.parse(d.topics_json || '[]'),
      thresholds: JSON.parse(d.thresholds_json || '[]'),
    }))
    .filter((d) => {
      if (jurisdiction && !String(d.jurisdiction).toLowerCase().includes(jurisdiction)) return false;
      if (regulator && !String(d.regulator).toLowerCase().includes(regulator)) return false;
      if (identifier && !String(d.regulatory_identifier).toLowerCase().includes(identifier)) return false;
      if (status && String(d.latest_change_status).toUpperCase() !== status) return false;
      if (dateFrom && String(d.publication_date) < dateFrom) return false;
      if (dateTo && String(d.publication_date) > dateTo) return false;
      if (oblDocs && !oblDocs.has(d.id)) return false;
      if (topic && !d.topics.some((t: string) => t.toLowerCase().includes(topic))) return false;
      if (q) {
        const hay = `${d.regulatory_identifier} ${d.title} ${d.regulator} ${d.jurisdiction} ${d.topics.join(' ')} ${d.industryTags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

  res.json(filtered);
});

regulatoryRouter.get('/regulatory-documents/:id', (req, res) => {
  const doc = db
    .prepare(
      `SELECT rd.*, rs.name as source_name, rs.source_type as source_type
       FROM regulatory_documents rd
       JOIN regulatory_sources rs ON rs.id = rd.source_id
       WHERE rd.id = ?`
    )
    .get(req.params.id) as any;

  if (!doc) {
    res.status(404).json({ error: 'Regulatory document not found.' });
    return;
  }

  const versions = db
    .prepare(`SELECT * FROM regulatory_document_versions WHERE document_id = ? ORDER BY version_number DESC`)
    .all(doc.id)
    .map((v: any) => ({ ...v, sections: JSON.parse(v.sections_json || '[]') }));

  const changes = db
    .prepare(`SELECT * FROM regulatory_changes WHERE document_id = ? ORDER BY change_date DESC, created_at DESC`)
    .all(doc.id)
    .map((c: any) => ({
      ...c,
      structuredDiff: JSON.parse(c.structured_diff_json || '[]'),
      aiSummary: c.ai_summary_json ? JSON.parse(c.ai_summary_json) : null,
    }));

  const obligations = db
    .prepare(`SELECT * FROM regulatory_obligations WHERE regulation_id = ? ORDER BY created_at DESC`)
    .all(doc.id)
    .map((o: any) => ({
      ...o,
      applicabilityConditions: JSON.parse(o.applicability_conditions_json || '{}'),
      evidenceRequired: JSON.parse(o.evidence_required_json || '[]'),
    }));

  const lineage = regulatoryGraphStore.getLineage(doc.id);

  res.json({
    document: {
      ...doc,
      industryTags: JSON.parse(doc.industry_tags_json || '[]'),
      companyTypes: JSON.parse(doc.company_types_json || '[]'),
      topics: JSON.parse(doc.topics_json || '[]'),
      thresholds: JSON.parse(doc.thresholds_json || '[]'),
    },
    versions,
    changes,
    obligations,
    lineage,
  });
});

// --- Regulatory Change Feed & Diff Detail ---
regulatoryRouter.get('/regulatory-changes', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const q = String(req.query.q || '').trim().toLowerCase();
  const jurisdiction = String(req.query.jurisdiction || '').trim().toLowerCase();
  const regulator = String(req.query.regulator || '').trim().toLowerCase();
  const severity = String(req.query.severity || '').trim().toLowerCase();
  const changeType = String(req.query.changeType || '').trim().toUpperCase();
  const unreviewedOnly = req.query.unreviewedOnly === 'true';

  const rows = db
    .prepare(
      `SELECT rc.*, rs.name as source_name, rs.source_type as source_type,
        ocr.review_status as org_review_status, ocr.reviewed_by as org_reviewed_by, ocr.reviewed_at as org_reviewed_at
       FROM regulatory_changes rc
       JOIN regulatory_sources rs ON rs.id = rc.source_id
       LEFT JOIN organization_change_reviews ocr ON ocr.change_id = rc.id AND ocr.organization_id = ?
       ORDER BY rc.change_date DESC, rc.created_at DESC`
    )
    .all(orgId) as Array<any>;

  const formatted = rows
    .map((r) => ({
      ...r,
      org_review_status: r.org_review_status || 'UNREVIEWED',
      structuredDiff: JSON.parse(r.structured_diff_json || '[]'),
      aiSummary: r.ai_summary_json ? JSON.parse(r.ai_summary_json) : null,
    }))
    .filter((r) => {
      if (jurisdiction && !String(r.jurisdiction).toLowerCase().includes(jurisdiction)) return false;
      if (regulator && !String(r.regulator).toLowerCase().includes(regulator)) return false;
      if (severity && String(r.severity).toLowerCase() !== severity) return false;
      if (changeType && String(r.change_type).toUpperCase() !== changeType) return false;
      if (unreviewedOnly && r.org_review_status !== 'UNREVIEWED') return false;
      if (q) {
        const hay = `${r.regulatory_identifier} ${r.regulation_title} ${r.regulator} ${r.jurisdiction} ${r.diff_summary_text} ${r.aiSummary?.summary || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

  res.json(formatted);
});

regulatoryRouter.get('/regulatory-changes/:id', (req, res) => {
  const orgId = req.auth!.organizationId!;
  const change = db
    .prepare(
      `SELECT rc.*, rs.name as source_name, rs.source_type as source_type, rs.source_url as source_feed_url
       FROM regulatory_changes rc
       JOIN regulatory_sources rs ON rs.id = rc.source_id
       WHERE rc.id = ?`
    )
    .get(req.params.id) as any;

  if (!change) {
    res.status(404).json({ error: 'Regulatory change not found.' });
    return;
  }

  const newVersion = db
    .prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`)
    .get(change.new_version_id) as any;

  const oldVersion = change.previous_version_id
    ? (db.prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`).get(change.previous_version_id) as any)
    : null;

  const obligations = db
    .prepare(`SELECT * FROM regulatory_obligations WHERE change_id = ? OR regulation_version_id = ? ORDER BY created_at ASC`)
    .all(change.id, change.new_version_id)
    .map((o: any) => ({
      ...o,
      applicabilityConditions: JSON.parse(o.applicability_conditions_json || '{}'),
      evidenceRequired: JSON.parse(o.evidence_required_json || '[]'),
    }));

  const versionHistory = db
    .prepare(
      `SELECT id, version_number, publication_date, effective_date, retrieved_at, content_hash, change_status, previous_version_id, next_version_id
       FROM regulatory_document_versions WHERE document_id = ? ORDER BY version_number ASC`
    )
    .all(change.document_id);

  const review = db
    .prepare(`SELECT * FROM organization_change_reviews WHERE organization_id = ? AND change_id = ?`)
    .get(orgId, change.id);

  const lineage = regulatoryGraphStore.getLineage(change.document_id);

  res.json({
    change: {
      ...change,
      structuredDiff: JSON.parse(change.structured_diff_json || '[]'),
      aiSummary: change.ai_summary_json ? JSON.parse(change.ai_summary_json) : null,
    },
    oldVersion: oldVersion
      ? { ...oldVersion, sections: JSON.parse(oldVersion.sections_json || '[]') }
      : null,
    newVersion: newVersion
      ? { ...newVersion, sections: JSON.parse(newVersion.sections_json || '[]') }
      : null,
    versionHistory,
    obligations,
    lineage,
    organizationReview: review || {
      organization_id: orgId,
      change_id: change.id,
      review_status: 'UNREVIEWED',
      reviewed_by: null,
      notes: null,
      reviewed_at: null,
    },
  });
});

regulatoryRouter.post(
  '/regulatory-changes/:id/analyze',
  requireOrgRole(['org_admin', 'compliance_officer']),
  async (req, res) => {
    try {
      const result = await runLiveAiSummaryForChange(req.params.id);
      logAuditEvent({
        organizationId: req.auth!.organizationId!,
        actorName: req.auth!.fullName,
        actorRole: req.auth!.role,
        action: 'AI regulatory change interpretation completed',
        objectType: 'RegulatoryChange',
        objectId: req.params.id,
        objectLabel: req.params.id,
        previousState: 'Deterministic diff',
        newState: `AI summarized (${result.extractedObligationsCount} obligations)`,
        sourceRef: 'Gemini 4 Hydrogen Change Intelligence',
      });
      res.json(result);
    } catch (err: any) {
      res.status(502).json({
        error: err?.message || 'Unable to run AI regulatory change interpretation.',
        code: 'AI_UNAVAILABLE',
      });
    }
  }
);

regulatoryRouter.post(
  '/regulatory-changes/:id/review',
  requireOrgRole(['org_admin', 'compliance_officer']),
  (req, res) => {
    const orgId = req.auth!.organizationId!;
    const { reviewStatus, notes } = req.body ?? {};
    const valid = ['REVIEWED', 'APPLICABLE', 'NOT_APPLICABLE', 'UNREVIEWED'];
    if (!valid.includes(String(reviewStatus))) {
      res.status(400).json({ error: 'Invalid reviewStatus.' });
      return;
    }

    const change = db.prepare(`SELECT id, regulatory_identifier FROM regulatory_changes WHERE id = ?`).get(req.params.id) as any;
    if (!change) {
      res.status(404).json({ error: 'Regulatory change not found.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organization_change_reviews (organization_id, change_id, review_status, reviewed_by, notes, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, change_id) DO UPDATE SET
         review_status = excluded.review_status,
         reviewed_by = excluded.reviewed_by,
         notes = excluded.notes,
         reviewed_at = excluded.reviewed_at`
    ).run(orgId, change.id, String(reviewStatus), req.auth!.fullName, String(notes || ''), now);

    logAuditEvent({
      organizationId: orgId,
      actorName: req.auth!.fullName,
      actorRole: req.auth!.role,
      action: 'Regulatory change reviewed',
      objectType: 'RegulatoryChange',
      objectId: change.id,
      objectLabel: change.regulatory_identifier,
      previousState: 'UNREVIEWED',
      newState: String(reviewStatus),
      sourceRef: 'Regulatory Change Feed',
    });

    res.json({ ok: true, reviewStatus, reviewedBy: req.auth!.fullName, reviewedAt: now });
  }
);

// --- Obligations Search ---
regulatoryRouter.get('/obligations', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const jurisdiction = String(req.query.jurisdiction || '').trim().toLowerCase();
  const regulator = String(req.query.regulator || '').trim().toLowerCase();
  const obligationType = String(req.query.obligationType || '').trim().toUpperCase();
  const regulationId = String(req.query.regulationId || '').trim();

  const rows = db
    .prepare(
      `SELECT ro.*, rd.regulatory_identifier, rd.title as regulation_title, rd.effective_date, rd.source_url,
        rv.version_number
       FROM regulatory_obligations ro
       JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       JOIN regulatory_document_versions rv ON rv.id = ro.regulation_version_id
       ORDER BY ro.created_at DESC`
    )
    .all() as Array<any>;

  const filtered = rows
    .map((r) => ({
      ...r,
      applicabilityConditions: JSON.parse(r.applicability_conditions_json || '{}'),
      evidenceRequired: JSON.parse(r.evidence_required_json || '[]'),
    }))
    .filter((r) => {
      if (jurisdiction && !String(r.jurisdiction).toLowerCase().includes(jurisdiction)) return false;
      if (regulator && !String(r.regulator).toLowerCase().includes(regulator)) return false;
      if (obligationType && String(r.obligation_type).toUpperCase() !== obligationType) return false;
      if (regulationId && r.regulation_id !== regulationId) return false;
      if (q) {
        const hay = `${r.title} ${r.description} ${r.obligation_type} ${r.regulatory_identifier} ${r.regulation_title} ${r.regulator}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

  res.json(filtered);
});

// --- Observability ---
regulatoryRouter.get('/regulatory-observability', (_req, res) => {
  const runs = db
    .prepare(
      `SELECT rir.*, rs.name as source_name, rs.jurisdiction
       FROM regulatory_ingestion_runs rir
       LEFT JOIN regulatory_sources rs ON rs.id = rir.source_id
       ORDER BY rir.started_at DESC LIMIT 40`
    )
    .all()
    .map((r: any) => ({ ...r, events: JSON.parse(r.events_json || '[]') }));
  res.json(runs);
});
