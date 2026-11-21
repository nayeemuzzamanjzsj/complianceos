import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { db } from '../db.ts';
import {
  computeContentHash,
  computeStructuredRegulatoryDiff,
  normalizeRegulatoryText,
} from './regulatoryDiff.ts';
import {
  extractDeterministicObligations,
  regulatoryAiProvider,
  type ExtractedObligationInput,
  type SemanticChangeSummary,
} from './regulatoryAi.ts';
import { regulatoryGraphStore } from './regulatoryGraph.ts';
import { evaluateChangeAcrossOrganizations } from './applicabilityEngine.ts';

export interface IngestDocumentInput {
  sourceId: string;
  regulatoryIdentifier: string;
  title: string;
  jurisdiction: string;
  country?: string;
  stateProvince?: string | null;
  regulator: string;
  documentType?: string;
  publicationDate?: string;
  effectiveDate?: string;
  sourceUrl: string;
  contentType?: string;
  rawContent: string | Buffer;
  rawDocumentLocation?: string | null;
  explicitStatus?: string;
  industryTags?: string[];
  companyTypes?: string[];
  businessActivities?: string[];
  regulatedProducts?: string[];
  thresholds?: string[];
  topics?: string[];
  isDemo?: boolean;
  runAi?: boolean;
}

export interface IngestionOutcome {
  runId: string;
  status: 'NEW_VERSION' | 'UNCHANGED' | 'FAILED';
  documentId?: string;
  versionId?: string;
  versionNumber?: number;
  changeId?: string | null;
  changeStatus?: string;
  obligationsExtracted: number;
  aiExecuted: boolean;
  events: string[];
  error?: string;
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower === '0.0.0.0') {
    return true;
  }
  const ipVer = net.isIP(lower);
  if (ipVer === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }
  if (ipVer === 6) {
    if (lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) {
      return true;
    }
  }
  return false;
}

export function assertSafeExternalUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid regulatory source URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Regulatory source URL must use http or https.');
  }
  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    throw new Error('Regulatory source URL points to a disallowed internal or loopback host.');
  }
  return parsed;
}

export function extractMeaningfulContent(
  rawInput: string | Buffer,
  contentType = 'text/plain',
  filenameHint = ''
): { extractedText: string; extractedMetadata: { title?: string; identifier?: string; effectiveDate?: string; publicationDate?: string } } {
  const ext = path.extname(filenameHint).toLowerCase();
  const mime = contentType.toLowerCase();

  if (Buffer.isBuffer(rawInput)) {
    const isTextLike =
      mime.includes('text/') ||
      mime.includes('json') ||
      mime.includes('xml') ||
      mime.includes('csv') ||
      ['.txt', '.md', '.html', '.htm', '.json', '.xml', '.csv'].includes(ext);

    if (!isTextLike) {
      // Safe ASCII/text extraction for PDF/binary documents preserving section & page structure
      const rawLatin = rawInput.toString('latin1');
      const asciiMatches = rawLatin.match(/[A-Za-z0-9.,;:'"()\[\]/\-–%\s]{6,}/g);
      const text = asciiMatches
        ? asciiMatches.join(' ').replace(/[ ]{2,}/g, ' ').trim()
        : '';
      if (text.length < 25) {
        throw new Error('Document extraction failed: unable to read structured regulatory text from uploaded binary file.');
      }
      return { extractedText: normalizeRegulatoryText(text.slice(0, 120000)), extractedMetadata: {} };
    }
    rawInput = rawInput.toString('utf8');
  }

  const rawStr = String(rawInput || '').trim();
  if (!rawStr) {
    throw new Error('Malformed regulatory document: empty content.');
  }

  // JSON structured regulatory payload
  if (mime.includes('json') || ext === '.json' || (rawStr.startsWith('{') && rawStr.endsWith('}'))) {
    try {
      const parsed = JSON.parse(rawStr) as Record<string, unknown>;
      const sectionsText = Array.isArray(parsed.sections)
        ? parsed.sections
            .map((s: any, idx: number) => `Section ${s.section || idx + 1}.0: ${s.heading || ''}\n${s.text || s.content || ''}`)
            .join('\n\n')
        : '';
      const body = String(parsed.text || parsed.content || parsed.body || sectionsText || '').trim();
      if (!body) {
        throw new Error('JSON regulatory payload missing text or sections content.');
      }
      return {
        extractedText: normalizeRegulatoryText(body),
        extractedMetadata: {
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          identifier: typeof parsed.regulatory_identifier === 'string' ? parsed.regulatory_identifier : undefined,
          effectiveDate: typeof parsed.effective_date === 'string' ? parsed.effective_date : undefined,
          publicationDate: typeof parsed.publication_date === 'string' ? parsed.publication_date : undefined,
        },
      };
    } catch (err: any) {
      if (mime.includes('json') || ext === '.json') {
        throw new Error(`Malformed JSON regulatory document: ${err?.message || 'parse error'}`);
      }
    }
  }

  // HTML / XML stripping (remove navigation, header, footer, script, style noise)
  if (mime.includes('html') || ext === '.html' || ext === '.htm' || /<(?:html|body|article|rss|feed|xml)/i.test(rawStr.slice(0, 500))) {
    const titleMatch = rawStr.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const cleaned = rawStr
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"');

    const normalized = normalizeRegulatoryText(cleaned);
    if (normalized.length < 20) {
      throw new Error('HTML extraction failed: no meaningful regulatory content found.');
    }
    return {
      extractedText: normalized.slice(0, 120000),
      extractedMetadata: {
        title: titleMatch ? normalizeRegulatoryText(titleMatch[1]) : undefined,
      },
    };
  }

  // CSV / Plain text / Markdown
  const normalized = normalizeRegulatoryText(rawStr);
  if (normalized.length < 15) {
    throw new Error('Malformed regulatory document: extracted text is too short.');
  }
  return { extractedText: normalized.slice(0, 120000), extractedMetadata: {} };
}

export async function fetchRegulatorySourceWithRetries(
  sourceUrl: string,
  maxRetries = 2
): Promise<{ body: string; contentType: string }> {
  const safeUrl = assertSafeExternalUrl(sourceUrl);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(safeUrl.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json, application/xml, text/html, text/plain, */*',
          'User-Agent': 'ComplianceOS-RegulatoryMonitor/1.0',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status >= 500 && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        throw new Error(`Upstream source returned HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || 'text/plain';
      const body = await response.text();
      return { body, contentType };
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
    }
  }

  throw lastError || new Error('Source fetch failed.');
}

function recordIngestionRun(params: {
  runId: string;
  sourceId: string | null;
  status: string;
  documentsFetched: number;
  versionsCreated: number;
  changesDetected: number;
  obligationsExtracted: number;
  errorMessage: string | null;
  events: string[];
  startedAt: string;
}): void {
  db.prepare(
    `INSERT INTO regulatory_ingestion_runs (
      id, source_id, status, documents_fetched, versions_created, changes_detected,
      obligations_extracted, error_message, events_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    params.runId,
    params.sourceId,
    params.status,
    params.documentsFetched,
    params.versionsCreated,
    params.changesDetected,
    params.obligationsExtracted,
    params.errorMessage,
    JSON.stringify(params.events),
    params.startedAt,
    new Date().toISOString()
  );
}

export async function ingestRegulatoryDocument(input: IngestDocumentInput): Promise<IngestionOutcome> {
  const runId = `run_${crypto.randomUUID().slice(0, 10)}`;
  const startedAt = new Date().toISOString();
  const events: string[] = [`source check started (${input.regulatoryIdentifier})`];

  try {
    const source = db
      .prepare(`SELECT * FROM regulatory_sources WHERE id = ?`)
      .get(input.sourceId) as any;
    if (!source) {
      throw new Error(`Regulatory source "${input.sourceId}" does not exist.`);
    }

    const { extractedText, extractedMetadata } = extractMeaningfulContent(
      input.rawContent,
      input.contentType || 'text/plain',
      input.rawDocumentLocation || ''
    );
    events.push('parsing completed');

    const title = (input.title || extractedMetadata.title || input.regulatoryIdentifier).trim();
    const identifier = (input.regulatoryIdentifier || extractedMetadata.identifier || '').trim();
    if (!identifier || !title) {
      throw new Error('Malformed regulatory document: regulatory_identifier and title are required.');
    }

    const contentHash = computeContentHash(extractedText);
    const now = new Date().toISOString();
    const pubDate = input.publicationDate || extractedMetadata.publicationDate || now.slice(0, 10);
    const effDate = input.effectiveDate || extractedMetadata.effectiveDate || pubDate;

    // Look up existing canonical regulatory document by source + identifier (or identifier + jurisdiction)
    const existingDoc = db
      .prepare(
        `SELECT * FROM regulatory_documents
         WHERE regulatory_identifier = ? AND jurisdiction = ? LIMIT 1`
      )
      .get(identifier, input.jurisdiction) as any;

    let previousVersion: any = null;
    if (existingDoc?.current_version_id) {
      previousVersion = db
        .prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`)
        .get(existingDoc.current_version_id);
    }

    // Content fingerprint deduplication: exact hash match -> DO NOT create a new version
    if (previousVersion && previousVersion.content_hash === contentHash) {
      events.push('source unchanged (content hash matched)');
      events.push('source check completed');

      db.prepare(
        `UPDATE regulatory_sources
         SET last_checked_at = ?, last_successful_fetch_at = ?, last_content_hash = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, now, contentHash, now, input.sourceId);

      recordIngestionRun({
        runId,
        sourceId: input.sourceId,
        status: 'UNCHANGED',
        documentsFetched: 1,
        versionsCreated: 0,
        changesDetected: 0,
        obligationsExtracted: 0,
        errorMessage: null,
        events,
        startedAt,
      });

      return {
        runId,
        status: 'UNCHANGED',
        documentId: existingDoc.id,
        versionId: previousVersion.id,
        versionNumber: previousVersion.version_number,
        changeId: null,
        changeStatus: 'UNCHANGED',
        obligationsExtracted: 0,
        aiExecuted: false,
        events,
      };
    }

    const nextVersionNumber = previousVersion ? Number(previousVersion.version_number) + 1 : 1;
    events.push(`new version detected (v${nextVersionNumber})`);

    // Deterministic diff BEFORE AI or DB write
    const diffResult = computeStructuredRegulatoryDiff({
      previousText: previousVersion ? String(previousVersion.extracted_text) : null,
      newText: extractedText,
      identifier,
      versionNumber: nextVersionNumber,
      explicitStatus: input.explicitStatus,
      newTitle: title,
    });
    events.push(`diff completed (${diffResult.items.length} structured items)`);

    // Optional AI interpretation & obligation extraction (never corrupts stored version if AI fails)
    let aiSummary: SemanticChangeSummary | null = null;
    let extractedObligations: ExtractedObligationInput[] = [];
    let aiExecuted = false;

    const shouldCallAi = input.runAi !== false && regulatoryAiProvider.isConfigured();
    if (shouldCallAi) {
      try {
        aiSummary = await regulatoryAiProvider.interpretChange({
          identifier,
          title,
          regulator: input.regulator,
          jurisdiction: input.jurisdiction,
          versionNumber: nextVersionNumber,
          diffItems: diffResult.items,
          boundedExcerpt: extractedText.slice(0, 6000),
        });
        events.push('AI interpretation completed');
        aiExecuted = true;
      } catch (aiErr: any) {
        events.push(`AI interpretation skipped (${aiErr?.message || 'error'})`);
      }

      try {
        extractedObligations = await regulatoryAiProvider.extractObligations({
          identifier,
          title,
          regulator: input.regulator,
          jurisdiction: input.jurisdiction,
          versionNumber: nextVersionNumber,
          sections: diffResult.newSections,
          diffItems: diffResult.items,
        });
        events.push(`AI obligation extraction completed (${extractedObligations.length})`);
        aiExecuted = true;
      } catch (oblErr: any) {
        events.push(`AI obligation extraction fallback (${oblErr?.message || 'error'})`);
        extractedObligations = extractDeterministicObligations({
          identifier,
          jurisdiction: input.jurisdiction,
          regulator: input.regulator,
          versionNumber: nextVersionNumber,
          sections: diffResult.newSections,
          diffItems: diffResult.items,
        });
      }
    } else {
      extractedObligations = extractDeterministicObligations({
        identifier,
        jurisdiction: input.jurisdiction,
        regulator: input.regulator,
        versionNumber: nextVersionNumber,
        sections: diffResult.newSections,
        diffItems: diffResult.items,
      });
      events.push(`obligation extraction completed (${extractedObligations.length}, deterministic)`);
    }

    const docId = existingDoc ? existingDoc.id : `rdoc_${crypto.randomUUID().slice(0, 10)}`;
    const versionId = `rver_${crypto.randomUUID().slice(0, 10)}`;
    const changeId = `rchg_${crypto.randomUUID().slice(0, 10)}`;

    // Atomic immutable storage transaction: never overwrites previous version content
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!existingDoc) {
        db.prepare(
          `INSERT INTO regulatory_documents (
            id, source_id, jurisdiction, country, state_province, regulator, title, document_type,
            regulatory_identifier, industry_tags_json, company_types_json, business_activities_json,
            regulated_products_json, thresholds_json, topics_json, current_version_id,
            current_version_number, latest_change_status, publication_date, effective_date,
            source_url, is_demo, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          docId,
          input.sourceId,
          input.jurisdiction,
          input.country || input.jurisdiction,
          input.stateProvince ?? null,
          input.regulator,
          title,
          input.documentType || 'Circular',
          identifier,
          JSON.stringify(input.industryTags || ['Financial Services']),
          JSON.stringify(input.companyTypes || ['Regulated Financial Institution']),
          JSON.stringify(input.businessActivities || ['Payment & Compliance Operations']),
          JSON.stringify(input.regulatedProducts || []),
          JSON.stringify(input.thresholds || []),
          JSON.stringify(input.topics || []),
          versionId,
          nextVersionNumber,
          diffResult.changeStatus,
          pubDate,
          effDate,
          input.sourceUrl,
          input.isDemo ? 1 : 0,
          now,
          now
        );
      }

      // Insert brand-new immutable version
      db.prepare(
        `INSERT INTO regulatory_document_versions (
          id, document_id, source_id, jurisdiction, regulator, title, document_type,
          regulatory_identifier, publication_date, effective_date, retrieved_at, source_url,
          content_hash, version_number, previous_version_id, next_version_id, change_status,
          raw_document_location, extracted_text, sections_json, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'ACTIVE', ?)`
      ).run(
        versionId,
        docId,
        input.sourceId,
        input.jurisdiction,
        input.regulator,
        title,
        input.documentType || 'Circular',
        identifier,
        pubDate,
        effDate,
        now,
        input.sourceUrl,
        contentHash,
        nextVersionNumber,
        previousVersion ? previousVersion.id : null,
        diffResult.changeStatus,
        input.rawDocumentLocation ?? null,
        extractedText,
        JSON.stringify(diffResult.newSections),
        now
      );

      // Link previous version forward pointer ONLY (never altering previous text/hash)
      if (previousVersion) {
        db.prepare(`UPDATE regulatory_document_versions SET next_version_id = ? WHERE id = ?`).run(
          versionId,
          previousVersion.id
        );
      }

      // Update canonical document pointer
      db.prepare(
        `UPDATE regulatory_documents
         SET current_version_id = ?, current_version_number = ?, latest_change_status = ?,
             publication_date = ?, effective_date = ?, title = ?, updated_at = ?
         WHERE id = ?`
      ).run(versionId, nextVersionNumber, diffResult.changeStatus, pubDate, effDate, title, now, docId);

      // Record requirements & knowledge graph lineage
      const reqIds = regulatoryGraphStore.recordRequirementsAndLineage({
        documentId: docId,
        versionId,
        versionNumber: nextVersionNumber,
        regulator: input.regulator,
        identifier,
        sections: diffResult.newSections,
      });

      // Store regulatory change event
      db.prepare(
        `INSERT INTO regulatory_changes (
          id, document_id, source_id, previous_version_id, new_version_id, jurisdiction, regulator,
          regulatory_identifier, regulation_title, change_type, severity, is_material, change_date,
          diff_summary_text, structured_diff_json, ai_summary_json, affected_obligation_count,
          source_url, is_demo, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        changeId,
        docId,
        input.sourceId,
        previousVersion ? previousVersion.id : null,
        versionId,
        input.jurisdiction,
        input.regulator,
        identifier,
        title,
        diffResult.changeStatus,
        diffResult.severity,
        diffResult.isMaterial ? 1 : 0,
        pubDate,
        diffResult.summaryText,
        JSON.stringify(diffResult.items),
        aiSummary ? JSON.stringify(aiSummary) : null,
        extractedObligations.length,
        input.sourceUrl,
        input.isDemo ? 1 : 0,
        now
      );

      // Store structured obligations linked to this version & change
      const insertObl = db.prepare(
        `INSERT INTO regulatory_obligations (
          id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
          regulator, title, description, obligation_type, applicability_conditions_json,
          required_action, deadline, frequency, responsible_entity, evidence_required_json,
          source_reference, confidence, change_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      extractedObligations.forEach((obl, idx) => {
        insertObl.run(
          `robl_${crypto.randomUUID().slice(0, 10)}`,
          docId,
          versionId,
          reqIds[idx] ?? reqIds[0] ?? null,
          changeId,
          input.jurisdiction,
          input.regulator,
          obl.title,
          obl.description,
          obl.obligation_type,
          JSON.stringify(obl.applicability_conditions || {}),
          obl.required_action,
          obl.deadline,
          obl.frequency,
          obl.responsible_entity,
          JSON.stringify(obl.evidence_required || []),
          obl.source_reference,
          obl.confidence,
          previousVersion ? 'MODIFIED' : 'NEW',
          now,
          now
        );
      });

      // Update source monitoring timestamps
      db.prepare(
        `UPDATE regulatory_sources
         SET last_checked_at = ?, last_successful_fetch_at = ?, last_content_hash = ?, last_error = NULL, updated_at = ?
         WHERE id = ?`
      ).run(now, now, contentHash, now, input.sourceId);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    try {
      const appResults = await evaluateChangeAcrossOrganizations(changeId);
      events.push(`applicability evaluation completed (${appResults.length} org assessments)`);
    } catch (appErr: any) {
      events.push(`applicability evaluation skipped (${appErr?.message || 'error'})`);
    }

    events.push('source check completed');
    recordIngestionRun({
      runId,
      sourceId: input.sourceId,
      status: 'COMPLETED',
      documentsFetched: 1,
      versionsCreated: 1,
      changesDetected: 1,
      obligationsExtracted: extractedObligations.length,
      errorMessage: null,
      events,
      startedAt,
    });

    return {
      runId,
      status: 'NEW_VERSION',
      documentId: docId,
      versionId,
      versionNumber: nextVersionNumber,
      changeId,
      changeStatus: diffResult.changeStatus,
      obligationsExtracted: extractedObligations.length,
      aiExecuted,
      events,
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Ingestion failed.';
    events.push(`ingestion failed: ${errMsg}`);

    try {
      db.prepare(`UPDATE regulatory_sources SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        errMsg,
        new Date().toISOString(),
        input.sourceId
      );
      recordIngestionRun({
        runId,
        sourceId: input.sourceId,
        status: 'FAILED',
        documentsFetched: 0,
        versionsCreated: 0,
        changesDetected: 0,
        obligationsExtracted: 0,
        errorMessage: errMsg,
        events,
        startedAt,
      });
    } catch {
      // Ignore secondary logging error
    }

    return {
      runId,
      status: 'FAILED',
      obligationsExtracted: 0,
      aiExecuted: false,
      events,
      error: errMsg,
    };
  }
}

export async function checkRegulatorySourceById(sourceId: string): Promise<IngestionOutcome> {
  const source = db.prepare(`SELECT * FROM regulatory_sources WHERE id = ?`).get(sourceId) as any;
  if (!source) {
    throw new Error('Regulatory source not found.');
  }

  // Demo fixture sources are explicitly checked against their deterministic fixture snapshot unless given a live external feed
  if (source.is_demo === 1 || String(source.source_url).includes('demo-fixture')) {
    const latestDoc = db
      .prepare(`SELECT * FROM regulatory_documents WHERE source_id = ? ORDER BY updated_at DESC LIMIT 1`)
      .get(source.id) as any;
    if (!latestDoc) {
      return {
        runId: `run_${crypto.randomUUID().slice(0, 10)}`,
        status: 'FAILED',
        obligationsExtracted: 0,
        aiExecuted: false,
        events: ['source check started', 'ingestion failed: no demo fixture document bound to source'],
        error: 'No regulatory document fixture attached to this demo source.',
      };
    }
    const latestVer = db
      .prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`)
      .get(latestDoc.current_version_id) as any;

    return ingestRegulatoryDocument({
      sourceId: source.id,
      regulatoryIdentifier: latestDoc.regulatory_identifier,
      title: latestDoc.title,
      jurisdiction: latestDoc.jurisdiction,
      country: latestDoc.country,
      stateProvince: latestDoc.state_province,
      regulator: latestDoc.regulator,
      documentType: latestDoc.document_type,
      publicationDate: latestDoc.publication_date,
      effectiveDate: latestDoc.effective_date,
      sourceUrl: source.source_url,
      rawContent: latestVer?.extracted_text || '',
      isDemo: true,
      runAi: false,
    });
  }

  // Live external HTTP source fetch with SSRF check, timeout, and retry
  const runId = `run_${crypto.randomUUID().slice(0, 10)}`;
  const startedAt = new Date().toISOString();
  try {
    const fetched = await fetchRegulatorySourceWithRetries(source.source_url);
    const existingDoc = db
      .prepare(`SELECT regulatory_identifier, title FROM regulatory_documents WHERE source_id = ? LIMIT 1`)
      .get(source.id) as any;

    return await ingestRegulatoryDocument({
      sourceId: source.id,
      regulatoryIdentifier: existingDoc?.regulatory_identifier || `${source.regulator.replace(/\s+/g, '-').toUpperCase()}-${new Date().getFullYear()}`,
      title: existingDoc?.title || source.name,
      jurisdiction: source.jurisdiction,
      country: source.jurisdiction,
      stateProvince: source.state_province,
      regulator: source.regulator,
      sourceUrl: source.source_url,
      contentType: fetched.contentType,
      rawContent: fetched.body,
      isDemo: false,
      runAi: true,
    });
  } catch (err: any) {
    const errMsg = err?.message || 'Unable to fetch regulatory source.';
    db.prepare(`UPDATE regulatory_sources SET last_checked_at = ?, last_error = ?, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      errMsg,
      new Date().toISOString(),
      source.id
    );
    recordIngestionRun({
      runId,
      sourceId: source.id,
      status: 'FAILED',
      documentsFetched: 0,
      versionsCreated: 0,
      changesDetected: 0,
      obligationsExtracted: 0,
      errorMessage: errMsg,
      events: ['source check started', `ingestion failed: ${errMsg}`],
      startedAt,
    });
    return {
      runId,
      status: 'FAILED',
      obligationsExtracted: 0,
      aiExecuted: false,
      events: ['source check started', `ingestion failed: ${errMsg}`],
      error: errMsg,
    };
  }
}

export async function runLiveAiSummaryForChange(changeId: string): Promise<{
  aiSummary: SemanticChangeSummary;
  extractedObligationsCount: number;
}> {
  const change = db.prepare(`SELECT * FROM regulatory_changes WHERE id = ?`).get(changeId) as any;
  if (!change) {
    throw new Error('Regulatory change not found.');
  }
  const newVer = db
    .prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`)
    .get(change.new_version_id) as any;
  if (!newVer) {
    throw new Error('Associated regulatory version not found.');
  }

  const diffItems = JSON.parse(change.structured_diff_json || '[]');
  const sections = JSON.parse(newVer.sections_json || '[]');

  const aiSummary = await regulatoryAiProvider.interpretChange({
    identifier: change.regulatory_identifier,
    title: change.regulation_title,
    regulator: change.regulator,
    jurisdiction: change.jurisdiction,
    versionNumber: newVer.version_number,
    diffItems,
    boundedExcerpt: String(newVer.extracted_text || '').slice(0, 6000),
  });

  let extractedCount = 0;
  try {
    const obligations = await regulatoryAiProvider.extractObligations({
      identifier: change.regulatory_identifier,
      title: change.regulation_title,
      regulator: change.regulator,
      jurisdiction: change.jurisdiction,
      versionNumber: newVer.version_number,
      sections,
      diffItems,
    });
    if (obligations.length > 0) {
      const now = new Date().toISOString();
      db.prepare(`DELETE FROM regulatory_obligations WHERE change_id = ?`).run(changeId);
      const insertObl = db.prepare(
        `INSERT INTO regulatory_obligations (
          id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
          regulator, title, description, obligation_type, applicability_conditions_json,
          required_action, deadline, frequency, responsible_entity, evidence_required_json,
          source_reference, confidence, change_status, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const obl of obligations) {
        insertObl.run(
          `robl_${crypto.randomUUID().slice(0, 10)}`,
          change.document_id,
          newVer.id,
          changeId,
          change.jurisdiction,
          change.regulator,
          obl.title,
          obl.description,
          obl.obligation_type,
          JSON.stringify(obl.applicability_conditions || {}),
          obl.required_action,
          obl.deadline,
          obl.frequency,
          obl.responsible_entity,
          JSON.stringify(obl.evidence_required || []),
          obl.source_reference,
          obl.confidence,
          change.change_type === 'NEW' ? 'NEW' : 'MODIFIED',
          now,
          now
        );
      }
      extractedCount = obligations.length;
    }
  } catch {
    extractedCount = change.affected_obligation_count || 0;
  }

  db.prepare(
    `UPDATE regulatory_changes SET ai_summary_json = ?, affected_obligation_count = CASE WHEN ? > 0 THEN ? ELSE affected_obligation_count END WHERE id = ?`
  ).run(JSON.stringify(aiSummary), extractedCount, extractedCount, changeId);

  return { aiSummary, extractedObligationsCount: extractedCount };
}
