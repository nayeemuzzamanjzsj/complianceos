import crypto from 'node:crypto';
import { db } from '../db.ts';

export interface RegulatoryLineageGraph {
  documentId: string;
  regulator: string;
  regulationIdentifier: string;
  nodes: Array<{ id: string; type: 'Regulator' | 'Regulation' | 'Version' | 'Requirement' | 'Obligation'; label: string }>;
  edges: Array<{ from: string; to: string; relationship: string }>;
}

export interface RegulatoryGraphStore {
  recordRequirementsAndLineage(params: {
    documentId: string;
    versionId: string;
    versionNumber: number;
    regulator: string;
    identifier: string;
    sections: Array<{ section: string; heading: string; text: string }>;
  }): string[];
  getLineage(documentId: string): RegulatoryLineageGraph | null;
}

class SqliteRegulatoryGraphStore implements RegulatoryGraphStore {
  recordRequirementsAndLineage(params: {
    documentId: string;
    versionId: string;
    versionNumber: number;
    regulator: string;
    identifier: string;
    sections: Array<{ section: string; heading: string; text: string }>;
  }): string[] {
    const reqIds: string[] = [];
    const now = new Date().toISOString();
    const insertReq = db.prepare(
      `INSERT INTO regulatory_requirements (
        id, document_id, version_id, section_ref, title, requirement_text, category, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const sec of params.sections.slice(0, 25)) {
      const reqId = `rreq_${crypto.randomUUID().slice(0, 10)}`;
      insertReq.run(
        reqId,
        params.documentId,
        params.versionId,
        sec.section,
        sec.heading.slice(0, 140),
        sec.text.slice(0, 1500),
        'Regulatory Provision',
        now
      );
      reqIds.push(reqId);
    }
    return reqIds;
  }

  getLineage(documentId: string): RegulatoryLineageGraph | null {
    const doc = db
      .prepare(`SELECT id, regulator, regulatory_identifier, title FROM regulatory_documents WHERE id = ?`)
      .get(documentId) as
      | { id: string; regulator: string; regulatory_identifier: string; title: string }
      | undefined;

    if (!doc) return null;

    const versions = db
      .prepare(
        `SELECT id, version_number, previous_version_id, change_status
         FROM regulatory_document_versions WHERE document_id = ? ORDER BY version_number ASC`
      )
      .all(documentId) as Array<{
      id: string;
      version_number: number;
      previous_version_id: string | null;
      change_status: string;
    }>;

    const requirements = db
      .prepare(
        `SELECT id, version_id, section_ref, title
         FROM regulatory_requirements WHERE document_id = ?`
      )
      .all(documentId) as Array<{ id: string; version_id: string; section_ref: string; title: string }>;

    const obligations = db
      .prepare(
        `SELECT id, regulation_version_id, requirement_id, obligation_type, title
         FROM regulatory_obligations WHERE regulation_id = ?`
      )
      .all(documentId) as Array<{
      id: string;
      regulation_version_id: string;
      requirement_id: string | null;
      obligation_type: string;
      title: string;
    }>;

    const nodes: RegulatoryLineageGraph['nodes'] = [];
    const edges: RegulatoryLineageGraph['edges'] = [];

    const regNodeId = `regulator:${doc.regulator}`;
    nodes.push({ id: regNodeId, type: 'Regulator', label: doc.regulator });
    nodes.push({ id: doc.id, type: 'Regulation', label: `${doc.regulatory_identifier}: ${doc.title}` });
    edges.push({ from: regNodeId, to: doc.id, relationship: 'ISSUES' });

    for (const v of versions) {
      nodes.push({ id: v.id, type: 'Version', label: `v${v.version_number} (${v.change_status})` });
      edges.push({ from: doc.id, to: v.id, relationship: 'HAS_VERSION' });
      if (v.previous_version_id) {
        edges.push({ from: v.previous_version_id, to: v.id, relationship: 'SUCCEEDED_BY' });
      }
    }

    for (const r of requirements) {
      nodes.push({ id: r.id, type: 'Requirement', label: `Sec. ${r.section_ref}: ${r.title}` });
      edges.push({ from: r.version_id, to: r.id, relationship: 'CONTAINS_REQUIREMENT' });
    }

    for (const o of obligations) {
      nodes.push({ id: o.id, type: 'Obligation', label: `[${o.obligation_type}] ${o.title}` });
      edges.push({
        from: o.requirement_id || o.regulation_version_id,
        to: o.id,
        relationship: 'IMPOSES_OBLIGATION',
      });
    }

    return {
      documentId: doc.id,
      regulator: doc.regulator,
      regulationIdentifier: doc.regulatory_identifier,
      nodes,
      edges,
    };
  }
}

export const regulatoryGraphStore: RegulatoryGraphStore = new SqliteRegulatoryGraphStore();
