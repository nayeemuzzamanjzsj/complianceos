import crypto from 'node:crypto';
import { db } from '../db.ts';
import { retrieveRelevantDocumentChunks, runAiApplicabilityAnalysis } from './ai.ts';
import { getCompanyProfile, saveCompanyProfile } from './companyProfile.ts';
import {
  analyzeObligationApplicability,
  getApplicabilityQueueAndSummary,
} from './applicabilityEngine.ts';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_regulations',
    description: 'Search monitored global and workspace regulations by keyword, jurisdiction, regulator, or identifier.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        jurisdiction: { type: 'string' },
        regulator: { type: 'string' },
      },
    },
  },
  {
    name: 'get_regulation',
    description: 'Retrieve full details, provenance, and version history for a specific regulation ID or identifier.',
    inputSchema: { type: 'object', properties: { regulationId: { type: 'string' } }, required: ['regulationId'] },
  },
  {
    name: 'get_regulation_version',
    description: 'Retrieve an immutable regulatory document version with sections, content hash, and provenance.',
    inputSchema: {
      type: 'object',
      properties: {
        versionId: { type: 'string' },
        documentId: { type: 'string' },
        versionNumber: { type: 'number' },
      },
    },
  },
  {
    name: 'compare_regulation_versions',
    description: 'Retrieve version-over-version regulatory diff highlights and structured changes for a regulation.',
    inputSchema: { type: 'object', properties: { regulationId: { type: 'string' } }, required: ['regulationId'] },
  },
  {
    name: 'search_obligations',
    description: 'Search structured regulatory obligations by keyword, jurisdiction, regulator, or obligation_type.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        jurisdiction: { type: 'string' },
        obligationType: { type: 'string' },
      },
    },
  },
  {
    name: 'get_regulatory_changes',
    description: 'Retrieve detected regulatory changes filtered by jurisdiction, regulator, severity, or changeType.',
    inputSchema: {
      type: 'object',
      properties: {
        jurisdiction: { type: 'string' },
        severity: { type: 'string' },
        changeType: { type: 'string' },
      },
    },
  },
  {
    name: 'summarize_regulatory_change',
    description: 'Return structured WHAT CHANGED summary, affected obligations, and source citations for a regulatory change ID.',
    inputSchema: { type: 'object', properties: { changeId: { type: 'string' } }, required: ['changeId'] },
  },
  {
    name: 'query_compliance_graph',
    description: 'Return Knowledge Graph edges connecting regulations, obligations, controls, policies, and systems.',
    inputSchema: { type: 'object', properties: { regulationId: { type: 'string' } } },
  },
  {
    name: 'get_company_profile',
    description: 'Return the normalized, versioned company profile and completeness status for the authenticated organization.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_company_profile',
    description: 'Update structured fields on the authenticated organization company profile and create a new profile version.',
    inputSchema: {
      type: 'object',
      properties: {
        profilePatch: { type: 'object' },
        changeSummary: { type: 'string' },
      },
      required: ['profilePatch'],
    },
  },
  {
    name: 'get_applicability_assessment',
    description: 'Retrieve the latest applicability assessment, reasoning, evidence, and human review status for an obligation.',
    inputSchema: {
      type: 'object',
      properties: { obligationId: { type: 'string' } },
      required: ['obligationId'],
    },
  },
  {
    name: 'analyze_applicability',
    description: 'Evaluate obligation applicability (via obligationId) or workspace regulation applicability (via regulationId) against the company profile.',
    inputSchema: {
      type: 'object',
      properties: {
        obligationId: { type: 'string' },
        regulationId: { type: 'string' },
        useAi: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_applicable_obligations',
    description: 'List all obligations currently assessed as APPLIES or POTENTIALLY_APPLIES for the authenticated organization.',
    inputSchema: {
      type: 'object',
      properties: {
        includePotential: { type: 'boolean' },
      },
    },
  },
  {
    name: 'get_missing_information',
    description: 'Return all obligations blocked on INSUFFICIENT_INFORMATION and the exact missing company profile fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'search_evidence',
    description: 'Search uploaded evidence items and document chunks within the organization workspace.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
  {
    name: 'create_remediation_action',
    description: 'Create a scoped remediation action inside the active organization.',
    inputSchema: {
      type: 'object',
      properties: {
        regulationId: { type: 'string' },
        title: { type: 'string' },
        requiredChange: { type: 'string' },
        priority: { type: 'string' },
        ownerDepartment: { type: 'string' },
      },
      required: ['regulationId', 'title', 'requiredChange'],
    },
  },
];

export async function executeMcpTool(
  organizationId: string,
  actorName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('MCP tool arguments must be a JSON object.');
  }

  switch (toolName) {
    case 'search_regulations': {
      const q = String(args.query ?? '').trim().toLowerCase();
      const jur = String(args.jurisdiction ?? '').trim().toLowerCase();
      const reg = String(args.regulator ?? '').trim().toLowerCase();

      const globalDocs = db
        .prepare(
          `SELECT id, regulatory_identifier as code, title, regulator, jurisdiction, current_version_number as current_version,
            latest_change_status as change_status, publication_date, effective_date, source_url
           FROM regulatory_documents`
        )
        .all() as Array<Record<string, unknown>>;

      const workspaceRegs = db
        .prepare(`SELECT id, code, title, regulator, jurisdiction, severity, applicability_status, status FROM regulations WHERE organization_id = ?`)
        .all(organizationId) as Array<Record<string, unknown>>;

      const filterFn = (r: Record<string, unknown>) => {
        if (jur && !String(r.jurisdiction || '').toLowerCase().includes(jur)) return false;
        if (reg && !String(r.regulator || '').toLowerCase().includes(reg)) return false;
        if (q && !`${r.code} ${r.title} ${r.regulator} ${r.jurisdiction}`.toLowerCase().includes(q)) return false;
        return true;
      };

      return {
        globalRegulations: globalDocs.filter(filterFn),
        workspaceRegulations: workspaceRegs.filter(filterFn),
      };
    }

    case 'get_regulation': {
      const regId = typeof args.regulationId === 'string' ? args.regulationId.trim() : '';
      if (!regId) throw new Error('regulationId string is required.');

      const globalDoc = db
        .prepare(`SELECT * FROM regulatory_documents WHERE id = ? OR regulatory_identifier = ? LIMIT 1`)
        .get(regId, regId);
      if (globalDoc) {
        const versions = db
          .prepare(`SELECT id, version_number, publication_date, effective_date, content_hash, change_status, source_url FROM regulatory_document_versions WHERE document_id = ? ORDER BY version_number DESC`)
          .all((globalDoc as any).id);
        return { scope: 'global', document: globalDoc, versions };
      }

      const reg = db
        .prepare(`SELECT * FROM regulations WHERE id = ? AND organization_id = ?`)
        .get(regId, organizationId);
      if (!reg) throw new Error('Regulation not found.');
      return { scope: 'workspace', regulation: reg };
    }

    case 'get_regulation_version': {
      const versionId = typeof args.versionId === 'string' ? args.versionId.trim() : '';
      const documentId = typeof args.documentId === 'string' ? args.documentId.trim() : '';
      const versionNumber = typeof args.versionNumber === 'number' ? args.versionNumber : null;

      let ver: any = null;
      if (versionId) {
        ver = db.prepare(`SELECT * FROM regulatory_document_versions WHERE id = ?`).get(versionId);
      } else if (documentId && versionNumber !== null) {
        ver = db
          .prepare(`SELECT * FROM regulatory_document_versions WHERE document_id = ? AND version_number = ?`)
          .get(documentId, versionNumber);
      } else {
        throw new Error('Provide either versionId, or documentId + versionNumber.');
      }

      if (!ver) throw new Error('Regulatory version not found.');
      return { ...ver, sections: JSON.parse(ver.sections_json || '[]') };
    }

    case 'compare_regulation_versions': {
      const regId = typeof args.regulationId === 'string' ? args.regulationId.trim() : '';
      if (!regId) throw new Error('regulationId string is required.');

      const globalChanges = db
        .prepare(
          `SELECT id, previous_version_id, new_version_id, change_type, severity, change_date, diff_summary_text, structured_diff_json
           FROM regulatory_changes WHERE document_id = ? ORDER BY change_date DESC`
        )
        .all(regId);

      if (globalChanges.length > 0) {
        return globalChanges.map((c: any) => ({
          ...c,
          structuredDiff: JSON.parse(c.structured_diff_json || '[]'),
        }));
      }

      return db
        .prepare(
          `SELECT version_number, published_at, effective_date, diff_previous_text, diff_new_text, diff_highlights_json, content_hash
           FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC`
        )
        .all(regId, organizationId);
    }

    case 'search_obligations': {
      const q = String(args.query ?? '').trim().toLowerCase();
      const jur = String(args.jurisdiction ?? '').trim().toLowerCase();
      const oblType = String(args.obligationType ?? '').trim().toUpperCase();

      const rows = db
        .prepare(
          `SELECT ro.id, ro.regulation_id, rd.regulatory_identifier, ro.jurisdiction, ro.regulator,
            ro.title, ro.obligation_type, ro.required_action, ro.deadline, ro.frequency,
            ro.responsible_entity, ro.source_reference, ro.confidence
           FROM regulatory_obligations ro
           JOIN regulatory_documents rd ON rd.id = ro.regulation_id`
        )
        .all() as Array<Record<string, unknown>>;

      return rows.filter((r) => {
        if (jur && !String(r.jurisdiction || '').toLowerCase().includes(jur)) return false;
        if (oblType && String(r.obligation_type || '').toUpperCase() !== oblType) return false;
        if (q && !`${r.title} ${r.required_action} ${r.regulatory_identifier} ${r.regulator}`.toLowerCase().includes(q)) return false;
        return true;
      });
    }

    case 'get_regulatory_changes': {
      const jur = String(args.jurisdiction ?? '').trim().toLowerCase();
      const sev = String(args.severity ?? '').trim().toLowerCase();
      const ct = String(args.changeType ?? '').trim().toUpperCase();

      const rows = db
        .prepare(
          `SELECT id, document_id, regulatory_identifier, regulation_title, regulator, jurisdiction,
            change_type, severity, is_material, change_date, diff_summary_text, affected_obligation_count, source_url
           FROM regulatory_changes ORDER BY change_date DESC`
        )
        .all() as Array<Record<string, unknown>>;

      return rows.filter((r) => {
        if (jur && !String(r.jurisdiction || '').toLowerCase().includes(jur)) return false;
        if (sev && String(r.severity || '').toLowerCase() !== sev) return false;
        if (ct && String(r.change_type || '').toUpperCase() !== ct) return false;
        return true;
      });
    }

    case 'summarize_regulatory_change': {
      const changeId = typeof args.changeId === 'string' ? args.changeId.trim() : '';
      if (!changeId) throw new Error('changeId string is required.');

      const change = db.prepare(`SELECT * FROM regulatory_changes WHERE id = ?`).get(changeId) as any;
      if (!change) throw new Error('Regulatory change not found.');

      const obligations = db
        .prepare(`SELECT id, title, obligation_type, deadline, source_reference FROM regulatory_obligations WHERE change_id = ?`)
        .all(changeId);

      return {
        changeId: change.id,
        regulatoryIdentifier: change.regulatory_identifier,
        title: change.regulation_title,
        regulator: change.regulator,
        jurisdiction: change.jurisdiction,
        changeType: change.change_type,
        severity: change.severity,
        sourceUrl: change.source_url,
        deterministicSummary: change.diff_summary_text,
        structuredDiff: JSON.parse(change.structured_diff_json || '[]'),
        aiSummary: change.ai_summary_json ? JSON.parse(change.ai_summary_json) : null,
        obligations,
      };
    }

    case 'query_compliance_graph': {
      const regId = args.regulationId ? String(args.regulationId) : null;
      if (regId) {
        return db
          .prepare(`SELECT * FROM graph_edges WHERE organization_id = ? AND regulation_id = ?`)
          .all(organizationId, regId);
      }
      return db.prepare(`SELECT * FROM graph_edges WHERE organization_id = ?`).all(organizationId);
    }

    case 'get_company_profile': {
      const state = getCompanyProfile(organizationId);
      if (!state) throw new Error('Company profile not found.');
      return {
        organizationId,
        organizationName: state.organization.name,
        versionNumber: state.versionNumber,
        completeness: state.completeness,
        structuredProfile: state.structuredProfile,
        updatedAt: state.updatedAt,
      };
    }

    case 'update_company_profile': {
      const patch = args.profilePatch as Record<string, any>;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new Error('profilePatch object is required.');
      }
      const updated = saveCompanyProfile({
        orgId: organizationId,
        structuredPatch: patch,
        actorName,
        actorRole: 'mcp_client',
        changeSummary: typeof args.changeSummary === 'string' ? args.changeSummary : 'Updated via MCP tool',
      });
      return {
        organizationId,
        versionNumber: updated.versionNumber,
        completeness: updated.completeness,
        structuredProfile: updated.structuredProfile,
      };
    }

    case 'get_applicability_assessment': {
      const obligationId = typeof args.obligationId === 'string' ? args.obligationId.trim() : '';
      if (!obligationId) throw new Error('obligationId string is required.');
      const queue = getApplicabilityQueueAndSummary(organizationId);
      const item = queue.items.find((i) => i.obligation.id === obligationId);
      if (!item) throw new Error('Obligation not found.');
      return {
        obligationId,
        obligationTitle: item.obligation.title,
        regulatoryIdentifier: item.obligation.regulatory_identifier,
        effectiveDecision: item.effective_decision,
        assessment: item.assessment,
      };
    }

    case 'get_applicable_obligations': {
      const includePotential = args.includePotential !== false;
      const queue = getApplicabilityQueueAndSummary(organizationId);
      return queue.items
        .filter(
          (i) =>
            i.effective_decision === 'APPLIES' ||
            (includePotential && i.effective_decision === 'POTENTIALLY_APPLIES')
        )
        .map((i) => ({
          obligationId: i.obligation.id,
          title: i.obligation.title,
          regulatoryIdentifier: i.obligation.regulatory_identifier,
          regulator: i.obligation.regulator,
          jurisdiction: i.obligation.jurisdiction,
          decision: i.effective_decision,
          confidence: i.assessment?.confidence_level || 'Medium',
          reason: i.assessment?.reasoning_summary || '',
          sourceReference: i.obligation.source_reference,
        }));
    }

    case 'get_missing_information': {
      const queue = getApplicabilityQueueAndSummary(organizationId);
      return queue.items
        .filter((i) => i.effective_decision === 'INSUFFICIENT_INFORMATION' || (i.assessment?.missing_information?.length ?? 0) > 0)
        .map((i) => ({
          obligationId: i.obligation.id,
          title: i.obligation.title,
          regulatoryIdentifier: i.obligation.regulatory_identifier,
          decision: i.effective_decision,
          missingInformation: i.assessment?.missing_information || [],
        }));
    }

    case 'search_evidence': {
      const q = String(args.query ?? '').trim();
      const evidence = db
        .prepare(`SELECT id, title, evidence_type, filename, status, created_at FROM evidence_items WHERE organization_id = ?`)
        .all(organizationId) as Array<Record<string, unknown>>;
      const chunks = retrieveRelevantDocumentChunks(organizationId, q || 'retention policy', 4);
      return { evidence, matchedDocumentChunks: chunks };
    }

    case 'analyze_applicability': {
      const obligationId = typeof args.obligationId === 'string' ? args.obligationId.trim() : '';
      if (obligationId) {
        return analyzeObligationApplicability({
          orgId: organizationId,
          obligationId,
          useAi: Boolean(args.useAi),
        });
      }

      const regId = String(args.regulationId ?? '');
      const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(organizationId) as Record<string, unknown> | undefined;
      const profileRow = db.prepare(`SELECT * FROM company_profiles WHERE organization_id = ?`).get(organizationId) as Record<string, unknown> | undefined;
      const reg = db.prepare(`SELECT * FROM regulations WHERE id = ? AND organization_id = ?`).get(regId, organizationId) as any;
      const ver = db
        .prepare(`SELECT * FROM regulation_versions WHERE regulation_id = ? AND organization_id = ? ORDER BY version_number DESC LIMIT 1`)
        .get(regId, organizationId) as any;
      if (!org || !profileRow || !reg || !ver) {
        throw new Error('Provide a valid obligationId or workspace regulationId.');
      }
      const profile = {
        business: JSON.parse(String(profileRow.business_json)),
        data: JSON.parse(String(profileRow.data_json)),
        infrastructure: JSON.parse(String(profileRow.infrastructure_json)),
        compliance: JSON.parse(String(profileRow.compliance_json)),
      };
      return runAiApplicabilityAnalysis({ organizationId, organization: org, profile, regulation: reg, latestVersion: ver });
    }

    case 'create_remediation_action': {
      const regId = String(args.regulationId ?? '');
      const reg = db.prepare(`SELECT id, code FROM regulations WHERE id = ? AND organization_id = ?`).get(regId, organizationId) as any;
      if (!reg) throw new Error('Target regulation not found in workspace.');
      const id = `rem_${crypto.randomUUID().slice(0, 10)}`;
      const now = new Date().toISOString();
      const code = `ACT-${Math.floor(100 + Math.random() * 900)}`;
      const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
      db.prepare(
        `INSERT INTO remediation_actions (
          id, organization_id, regulation_id, obligation_id, control_id, policy_id,
          code, title, description, required_change, owner_name, owner_department,
          priority, deadline, status, source_citation, confidence, required_evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, 'High', ?, ?, ?)`
      ).run(
        id,
        organizationId,
        regId,
        code,
        String(args.title),
        String(args.requiredChange),
        String(args.requiredChange),
        actorName,
        String(args.ownerDepartment || 'Compliance'),
        String(args.priority || 'HIGH'),
        deadline,
        `${reg.code} (via ComplianceOS MCP)`,
        JSON.stringify(['Implementation proof', 'Reviewer approval record']),
        now,
        now
      );
      return { createdId: id, code, status: 'Not Started' };
    }

    default:
      throw new Error(`Unknown MCP tool: ${toolName}`);
  }
}
