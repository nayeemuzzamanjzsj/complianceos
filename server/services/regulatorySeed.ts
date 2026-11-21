import { db } from '../db.ts';
import { computeContentHash, computeStructuredRegulatoryDiff } from './regulatoryDiff.ts';
import { regulatoryGraphStore } from './regulatoryGraph.ts';

export function seedGlobalRegulatoryIntelligence(): void {
  const existingSources = (db.prepare(`SELECT COUNT(*) as c FROM regulatory_sources`).get() as { c: number }).c;
  if (existingSources > 0) {
    seedApplicabilityDemoRegulations();
    return;
  }

  const now = '2026-11-20T09:00:00.000Z';

  // 1. Multi-Jurisdiction Monitored Sources (DEMO / SYNTHETIC fixtures)
  const insertSource = db.prepare(
    `INSERT INTO regulatory_sources (
      id, name, jurisdiction, state_province, regulator, source_type, source_url,
      description, active, monitoring_frequency, last_checked_at, last_successful_fetch_at,
      last_content_hash, last_error, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, 1, ?, ?)`
  );

  insertSource.run(
    'src_bb_psd',
    'Bangladesh Bank — Payment Systems Circulars [DEMO / SYNTHETIC]',
    'Bangladesh',
    null,
    'Bangladesh Bank',
    'circular',
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    'Synthetic demo feed tracking Payment Service Provider (PSP) and MFS retention & operational directives.',
    'hourly',
    '2026-11-20T08:45:00.000Z',
    '2026-11-20T08:45:00.000Z',
    null,
    now,
    now
  );

  insertSource.run(
    'src_bfiu_aml',
    'BFIU — Anti-Money Laundering Master Circulars [DEMO / SYNTHETIC]',
    'Bangladesh',
    null,
    'BFIU',
    'circular',
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    'Synthetic demo feed monitoring STR/CTR threshold updates and goAML schema revisions.',
    'hourly',
    '2026-11-20T08:45:00.000Z',
    '2026-11-20T08:45:00.000Z',
    null,
    now,
    now
  );

  insertSource.run(
    'src_btrc_dpg',
    'BTRC — Digital Payment Data Localization Gazette [DEMO / SYNTHETIC]',
    'Bangladesh',
    null,
    'BTRC',
    'gazette',
    'https://btrc.gov.bd/directives/dpg122026-demo-fixture',
    'Synthetic demo feed for sovereign cloud & key-custody requirements (demonstrates unchanged hash check).',
    'daily',
    '2026-11-20T08:50:00.000Z',
    '2026-11-20T08:50:00.000Z',
    null,
    now,
    now
  );

  insertSource.run(
    'src_us_nydfs',
    'NYDFS — 23 NYCRR Part 500 Cybersecurity Amendments [DEMO / SYNTHETIC]',
    'United States',
    'New York',
    'NYDFS',
    'regulation_database',
    'https://www.dfs.ny.gov/industry_guidance/cybersecurity-part500-demo-fixture',
    'Synthetic US state financial cybersecurity source demonstrating multi-jurisdiction awareness.',
    'daily',
    '2026-11-20T08:30:00.000Z',
    '2026-11-20T08:30:00.000Z',
    null,
    now,
    now
  );

  insertSource.run(
    'src_eu_esma',
    'ESMA — Digital Finance & MiCA Technical Standards [DEMO / SYNTHETIC]',
    'European Union',
    null,
    'ESMA',
    'government_website',
    'https://eur-lex.europa.eu/demo-mica-2026-88',
    'Synthetic EU financial supervisory register demonstrating non-applicable cross-jurisdiction filtering.',
    'daily',
    '2026-11-20T08:30:00.000Z',
    '2026-11-20T08:30:00.000Z',
    null,
    now,
    now
  );

  insertSource.run(
    'src_uk_fca',
    'UK FCA — Operational Resilience Policy Statements [DEMO / SYNTHETIC]',
    'United Kingdom',
    null,
    'FCA',
    'rss_atom',
    'https://www.fca.org.uk/publications/policy-statements/ps26-4-demo-fixture',
    'Synthetic UK FCA feed demonstrating multi-jurisdiction regulatory ingestion.',
    'weekly',
    '2026-11-20T08:30:00.000Z',
    '2026-11-20T08:30:00.000Z',
    null,
    now,
    now
  );

  const insertDoc = db.prepare(
    `INSERT INTO regulatory_documents (
      id, source_id, jurisdiction, country, state_province, regulator, title, document_type,
      regulatory_identifier, industry_tags_json, company_types_json, business_activities_json,
      regulated_products_json, thresholds_json, topics_json, current_version_id,
      current_version_number, latest_change_status, publication_date, effective_date,
      source_url, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  );

  const insertVer = db.prepare(
    `INSERT INTO regulatory_document_versions (
      id, document_id, source_id, jurisdiction, regulator, title, document_type,
      regulatory_identifier, publication_date, effective_date, retrieved_at, source_url,
      content_hash, version_number, previous_version_id, next_version_id, change_status,
      raw_document_location, extracted_text, sections_json, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'ACTIVE', ?)`
  );

  const insertChange = db.prepare(
    `INSERT INTO regulatory_changes (
      id, document_id, source_id, previous_version_id, new_version_id, jurisdiction, regulator,
      regulatory_identifier, regulation_title, change_type, severity, is_material, change_date,
      diff_summary_text, structured_diff_json, ai_summary_json, affected_obligation_count,
      source_url, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
  );

  const insertObl = db.prepare(
    `INSERT INTO regulatory_obligations (
      id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
      regulator, title, description, obligation_type, applicability_conditions_json,
      required_action, deadline, frequency, responsible_entity, evidence_required_json,
      source_reference, confidence, change_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // =========================================================================
  // CASE 1: MODIFIED REGULATION (v1 -> v2) — Bangladesh Bank Circular PSD-09/2026
  // =========================================================================
  const bbV1Text = `Section 4.1 Scope of Retention:
Licensed Payment Service Providers (PSPs) in Bangladesh shall maintain onboarding customer KYC records and digital payment settlement ledgers.

Section 4.2 Minimum Retention Period:
Payment Service Providers shall retain customer onboarding KYC records and digital transaction ledgers for a minimum period of 3 years from account closure or transaction settlement.

Section 4.3 Compliance Oversight:
The designated Compliance Officer shall review archival schedules annually.`;

  const bbV2Text = `Section 4.1 Scope of Retention:
Licensed Payment Service Providers (PSPs) and Mobile Financial Service operators in Bangladesh shall maintain onboarding customer KYC dossiers, biometric verification logs, and core settlement transaction ledgers.

Section 4.2 Minimum Retention Period:
Payment Service Providers and Mobile Financial Service operators shall retain all customer KYC dossiers, biometric verification logs, and core settlement transaction records for a minimum period of 5 years in tamper-evident immutable storage, with quarterly retention audit attestations.

Section 4.3 Compliance Oversight:
The designated Compliance Officer shall sign off quarterly retention audit attestations and verify S3 Object Lock WORM compliance within 30 days of quarter close.`;

  const bbV1Hash = computeContentHash(bbV1Text);
  const bbV2Hash = computeContentHash(bbV2Text);
  const bbDiff1 = computeStructuredRegulatoryDiff({
    previousText: null,
    newText: bbV1Text,
    identifier: 'BB-PSD-09/2026',
    versionNumber: 1,
  });
  const bbDiff2 = computeStructuredRegulatoryDiff({
    previousText: bbV1Text,
    newText: bbV2Text,
    identifier: 'BB-PSD-09/2026',
    versionNumber: 2,
  });

  insertDoc.run(
    'rdoc_bb_psd09',
    'src_bb_psd',
    'Bangladesh',
    'Bangladesh',
    null,
    'Bangladesh Bank',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive [DEMO]',
    'Circular',
    'BB-PSD-09/2026',
    JSON.stringify(['Financial Technology', 'Digital Payments', 'Banking']),
    JSON.stringify(['Payment Service Provider', 'Mobile Financial Service']),
    JSON.stringify(['Payment Processing', 'e-KYC Onboarding', 'Stored Value Issuance']),
    JSON.stringify(['Mobile Wallet', 'Merchant Settlement API']),
    JSON.stringify(['5 years minimum retention', 'Quarterly audit attestation']),
    JSON.stringify(['Data Retention', 'KYC Archival', 'Immutable Storage', 'Biometric Logs']),
    'rver_bb_psd09_v2',
    2,
    'MODIFIED',
    '2026-11-18',
    '2026-12-31',
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    now,
    now
  );

  insertVer.run(
    'rver_bb_psd09_v1',
    'rdoc_bb_psd09',
    'src_bb_psd',
    'Bangladesh',
    'Bangladesh Bank',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive [DEMO]',
    'Circular',
    'BB-PSD-09/2026',
    '2026-06-15',
    '2026-07-01',
    '2026-06-15T10:00:00.000Z',
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    bbV1Hash,
    1,
    null,
    'rver_bb_psd09_v2',
    'NEW',
    bbV1Text,
    JSON.stringify(bbDiff1.newSections),
    '2026-06-15T10:00:00.000Z'
  );

  insertVer.run(
    'rver_bb_psd09_v2',
    'rdoc_bb_psd09',
    'src_bb_psd',
    'Bangladesh',
    'Bangladesh Bank',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive [DEMO]',
    'Circular',
    'BB-PSD-09/2026',
    '2026-11-18',
    '2026-12-31',
    now,
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    bbV2Hash,
    2,
    'rver_bb_psd09_v1',
    null,
    'MODIFIED',
    bbV2Text,
    JSON.stringify(bbDiff2.newSections),
    now
  );

  const bbReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
    documentId: 'rdoc_bb_psd09',
    versionId: 'rver_bb_psd09_v2',
    versionNumber: 2,
    regulator: 'Bangladesh Bank',
    identifier: 'BB-PSD-09/2026',
    sections: bbDiff2.newSections,
  });

  insertChange.run(
    'rchg_bb_psd09_v2',
    'rdoc_bb_psd09',
    'src_bb_psd',
    'rver_bb_psd09_v1',
    'rver_bb_psd09_v2',
    'Bangladesh',
    'Bangladesh Bank',
    'BB-PSD-09/2026',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive [DEMO]',
    'MODIFIED',
    'High',
    1,
    '2026-11-18',
    bbDiff2.summaryText,
    JSON.stringify(bbDiff2.items),
    JSON.stringify({
      summary:
        'Bangladesh Bank extended minimum KYC and transaction ledger retention from 3 years to 5 years, added biometric verification logs to scope, and mandated tamper-evident immutable storage with quarterly compliance attestations.',
      meaning:
        'Organizations operating under 3-year archival lifecycle policies must upgrade database partitions and object storage lock rules before 2026-12-31.',
      is_obligation_change: true,
      affected_entities: ['Licensed Payment Service Providers (PSPs)', 'Mobile Financial Service Operators'],
      changed_deadlines: ['Quarterly retention audit attestations due within 30 days of quarter close (was annual)'],
      changed_thresholds: ['Minimum retention period increased from 3 years to 5 years'],
      operational_changes: [
        'Extend KYC Document Vault & Transaction DB retention to 5 years',
        'Enable S3 Object Lock / WORM immutable archival',
        'Include biometric verification logs in archival scope',
      ],
      material_changes: [
        'Retention duration increased: 3 years -> 5 years (Section 4.2)',
        'Added biometric verification logs to regulated retention scope (Section 4.1–4.2)',
        'Review frequency tightened: Annual -> Quarterly audit attestation (Section 4.3)',
      ],
      affected_obligation_types: ['RETAIN', 'PROTECT_DATA', 'CONDUCT_ASSESSMENT'],
      potential_impact:
        'High operational impact on storage lifecycle policies, S3 KMS vaults, and quarterly compliance governance sign-offs.',
      recommended_review: [
        'Review internal Data Retention Policy against 5-year threshold',
        'Audit S3 Object Lock / immutable storage configuration for KYC Vault',
        'Establish quarterly Compliance Officer attestation schedule',
      ],
      citations: [
        {
          version: 'v2',
          section: '4.2',
          excerpt: 'retain all customer KYC dossiers, biometric verification logs, and core settlement transaction records for a minimum period of 5 years in tamper-evident immutable storage',
        },
        {
          version: 'v2',
          section: '4.3',
          excerpt: 'sign off quarterly retention audit attestations and verify S3 Object Lock WORM compliance within 30 days of quarter close',
        },
      ],
      confidence: 'High',
      insufficient_evidence: false,
      ai_generated: false,
      model_name: 'demo-synthetic-fixture',
    }),
    2,
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    now
  );

  insertObl.run(
    'robl_bb_ret_5yr',
    'rdoc_bb_psd09',
    'rver_bb_psd09_v2',
    bbReqIds[1] ?? bbReqIds[0] ?? null,
    'rchg_bb_psd09_v2',
    'Bangladesh',
    'Bangladesh Bank',
    'Retain KYC dossiers, biometric logs, and transaction ledgers for 5 years',
    'Minimum retention duration increased from 3 years to 5 years in tamper-evident immutable storage.',
    'RETAIN',
    JSON.stringify({
      country: 'Bangladesh',
      industries: ['Financial Technology', 'Digital Payments'],
      company_types: ['Payment Service Provider', 'Mobile Financial Service'],
      thresholds: ['5 years minimum retention'],
    }),
    'Update Transaction DB archival and S3 KYC Vault lifecycle policies from 3 years to 5 years with Object Lock enabled.',
    '2026-12-31',
    'Continuous',
    'Payment Service Providers & MFS Operators',
    JSON.stringify(['S3 Object Lock WORM configuration', 'Updated Data Retention Policy']),
    'BB-PSD-09/2026 v2 · Section 4.2',
    'High',
    'MODIFIED',
    now,
    now
  );

  insertObl.run(
    'robl_bb_ret_attest',
    'rdoc_bb_psd09',
    'rver_bb_psd09_v2',
    bbReqIds[2] ?? bbReqIds[0] ?? null,
    'rchg_bb_psd09_v2',
    'Bangladesh',
    'Bangladesh Bank',
    'Execute quarterly immutable storage retention audit attestations',
    'Frequency tightened from annual review to quarterly Compliance Officer sign-off within 30 days of quarter close.',
    'CONDUCT_ASSESSMENT',
    JSON.stringify({
      country: 'Bangladesh',
      industries: ['Financial Technology', 'Digital Payments'],
      company_types: ['Payment Service Provider', 'Mobile Financial Service'],
    }),
    'Perform quarterly archival integrity verification and record Compliance Officer attestation.',
    'Within 30 days of quarter close',
    'Quarterly',
    'Compliance Officer',
    JSON.stringify(['Quarterly retention audit report', 'Signed attestation record']),
    'BB-PSD-09/2026 v2 · Section 4.3',
    'High',
    'NEW',
    now,
    now
  );

  // =========================================================================
  // CASE 2: REGULATION WITH MULTIPLE CHANGED OBLIGATIONS (BFIU-MC-34/2026)
  // =========================================================================
  const bfiuV1Text = `Section 7.1 Structuring Detection Window:
Reporting entities shall monitor cash-in and e-wallet transfers for split-deposit structuring over a 24-hour calendar window.

Section 7.2 Suspicious Transaction Report (STR) Filing:
Reporting entities shall submit STR filings to BFIU within 48 hours of internal investigation closure.

Section 7.3 Escalation Recordkeeping:
Compliance teams shall log alert dispositions in an internal case ledger.`;

  const bfiuV2Text = `Section 7.1 Structuring Detection Window:
Electronic wallet operators and PSPs must monitor split-deposit structuring across a rolling 4-hour window with automated velocity threshold alerts exceeding BDT 250,000.

Section 7.2 Suspicious Transaction Report (STR) Filing:
Reporting entities must generate and submit automated goAML XML STR filings to BFIU within 12 hours of alert escalation.

Section 7.3 Escalation Recordkeeping:
Compliance teams must notify the BFIU supervision desk immediately upon system outage exceeding 2 hours and maintain signed goAML acknowledgment receipts.`;

  const bfiuDiff1 = computeStructuredRegulatoryDiff({
    previousText: null,
    newText: bfiuV1Text,
    identifier: 'BFIU-MC-34/2026',
    versionNumber: 1,
  });
  const bfiuDiff2 = computeStructuredRegulatoryDiff({
    previousText: bfiuV1Text,
    newText: bfiuV2Text,
    identifier: 'BFIU-MC-34/2026',
    versionNumber: 2,
  });

  insertDoc.run(
    'rdoc_bfiu_mc34',
    'src_bfiu_aml',
    'Bangladesh',
    'Bangladesh',
    null,
    'BFIU',
    'Master Circular 34/2026: Real-Time Suspicious Transaction Reporting [DEMO]',
    'Master Directive',
    'BFIU-MC-34/2026',
    JSON.stringify(['Financial Technology', 'Digital Payments', 'Banking']),
    JSON.stringify(['Payment Service Provider', 'Electronic Wallet Operator']),
    JSON.stringify(['Wallet Transfers', 'AML/CFT Screening']),
    JSON.stringify(['Stored Value Wallet', 'P2P Transfers']),
    JSON.stringify(['Rolling 4-hour window', 'BDT 250,000 threshold', '12-hour goAML SLA']),
    JSON.stringify(['AML/CFT', 'STR Reporting', 'goAML XML', 'Transaction Monitoring']),
    'rver_bfiu_mc34_v2',
    2,
    'MODIFIED',
    '2026-11-19',
    '2026-12-15',
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    now,
    now
  );

  insertVer.run(
    'rver_bfiu_mc34_v1',
    'rdoc_bfiu_mc34',
    'src_bfiu_aml',
    'Bangladesh',
    'BFIU',
    'Master Circular 34/2026: Real-Time Suspicious Transaction Reporting [DEMO]',
    'Master Directive',
    'BFIU-MC-34/2026',
    '2026-05-01',
    '2026-06-01',
    '2026-05-01T09:00:00.000Z',
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    computeContentHash(bfiuV1Text),
    1,
    null,
    'rver_bfiu_mc34_v2',
    'NEW',
    bfiuV1Text,
    JSON.stringify(bfiuDiff1.newSections),
    '2026-05-01T09:00:00.000Z'
  );

  insertVer.run(
    'rver_bfiu_mc34_v2',
    'rdoc_bfiu_mc34',
    'src_bfiu_aml',
    'Bangladesh',
    'BFIU',
    'Master Circular 34/2026: Real-Time Suspicious Transaction Reporting [DEMO]',
    'Master Directive',
    'BFIU-MC-34/2026',
    '2026-11-19',
    '2026-12-15',
    now,
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    computeContentHash(bfiuV2Text),
    2,
    'rver_bfiu_mc34_v1',
    null,
    'MODIFIED',
    bfiuV2Text,
    JSON.stringify(bfiuDiff2.newSections),
    now
  );

  const bfiuReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
    documentId: 'rdoc_bfiu_mc34',
    versionId: 'rver_bfiu_mc34_v2',
    versionNumber: 2,
    regulator: 'BFIU',
    identifier: 'BFIU-MC-34/2026',
    sections: bfiuDiff2.newSections,
  });

  insertChange.run(
    'rchg_bfiu_mc34_v2',
    'rdoc_bfiu_mc34',
    'src_bfiu_aml',
    'rver_bfiu_mc34_v1',
    'rver_bfiu_mc34_v2',
    'Bangladesh',
    'BFIU',
    'BFIU-MC-34/2026',
    'Master Circular 34/2026: Real-Time Suspicious Transaction Reporting [DEMO]',
    'MODIFIED',
    'Critical',
    1,
    '2026-11-19',
    bfiuDiff2.summaryText,
    JSON.stringify(bfiuDiff2.items),
    JSON.stringify({
      summary:
        'BFIU compressed split-deposit monitoring from 24 hours to a rolling 4-hour window (BDT 250,000 threshold), shortened STR submission from 48 hours to 12 hours via automated goAML XML, and added a 2-hour outage notification duty.',
      meaning:
        'Batch daily AML screening jobs are no longer compliant; real-time streaming velocity detection and automated goAML XML export are required before 2026-12-15.',
      is_obligation_change: true,
      affected_entities: ['Electronic Wallet Operators', 'Licensed Payment Service Providers'],
      changed_deadlines: [
        'Monitoring window compressed: 24-hour calendar -> rolling 4-hour window',
        'STR filing deadline compressed: 48 hours -> 12 hours of alert escalation',
        'New 2-hour AML monitoring outage notification duty',
      ],
      changed_thresholds: ['Automated velocity alert threshold set at BDT 250,000 across rolling 4-hour window'],
      operational_changes: [
        'Reconfigure Flink/Kafka STR screening pipeline for 4-hour sliding window',
        'Deploy automated goAML XML generator and acknowledgment archiving',
      ],
      material_changes: [
        'Modified monitoring window (Section 7.1)',
        'Modified STR submission SLA & format (Section 7.2)',
        'Added system outage regulatory notification (Section 7.3)',
      ],
      affected_obligation_types: ['MONITOR', 'REPORT', 'NOTIFY'],
      potential_impact:
        'Critical SLA and engineering architecture impact on AML transaction monitoring pipelines.',
      recommended_review: [
        'Update STR Screening Pipeline window configuration',
        'Verify goAML XML schema export automation within 12-hour SLA',
        'Configure incident runbook for BFIU 2-hour outage notice',
      ],
      citations: [
        { version: 'v2', section: '7.1', excerpt: 'monitor split-deposit structuring across a rolling 4-hour window with automated velocity threshold alerts exceeding BDT 250,000' },
        { version: 'v2', section: '7.2', excerpt: 'submit automated goAML XML STR filings to BFIU within 12 hours of alert escalation' },
        { version: 'v2', section: '7.3', excerpt: 'notify the BFIU supervision desk immediately upon system outage exceeding 2 hours' },
      ],
      confidence: 'High',
      insufficient_evidence: false,
      ai_generated: false,
      model_name: 'demo-synthetic-fixture',
    }),
    3,
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    now
  );

  insertObl.run(
    'robl_bfiu_mon_4h',
    'rdoc_bfiu_mc34',
    'rver_bfiu_mc34_v2',
    bfiuReqIds[0] ?? null,
    'rchg_bfiu_mc34_v2',
    'Bangladesh',
    'BFIU',
    'Monitor split-deposit structuring over rolling 4-hour window',
    'Velocity window compressed from 24 hours to rolling 4 hours for alerts exceeding BDT 250,000.',
    'MONITOR',
    JSON.stringify({ country: 'Bangladesh', industries: ['Financial Technology', 'Digital Payments'], thresholds: ['BDT 250,000 / 4h'] }),
    'Configure streaming AML rules for 4-hour rolling velocity aggregation.',
    '2026-12-15',
    'Real-time continuous',
    'AML Risk Engineering',
    JSON.stringify(['Streaming rule config JSON', 'Synthetic velocity test output']),
    'BFIU-MC-34/2026 v2 · Section 7.1',
    'High',
    'MODIFIED',
    now,
    now
  );

  insertObl.run(
    'robl_bfiu_str_12h',
    'rdoc_bfiu_mc34',
    'rver_bfiu_mc34_v2',
    bfiuReqIds[1] ?? null,
    'rchg_bfiu_mc34_v2',
    'Bangladesh',
    'BFIU',
    'Submit automated goAML XML STR filings within 12 hours',
    'Filing SLA reduced from 48 hours to 12 hours using structured goAML XML export.',
    'REPORT',
    JSON.stringify({ country: 'Bangladesh', industries: ['Financial Technology', 'Digital Payments'] }),
    'Enable automated goAML XML report generation and submission within 12 hours of alert escalation.',
    'Within 12 hours of escalation',
    'Per alert escalation',
    'Compliance Officer',
    JSON.stringify(['Sample validated goAML XML', 'Submission timestamp logs']),
    'BFIU-MC-34/2026 v2 · Section 7.2',
    'High',
    'MODIFIED',
    now,
    now
  );

  insertObl.run(
    'robl_bfiu_notify_outage',
    'rdoc_bfiu_mc34',
    'rver_bfiu_mc34_v2',
    bfiuReqIds[2] ?? null,
    'rchg_bfiu_mc34_v2',
    'Bangladesh',
    'BFIU',
    'Notify BFIU desk upon AML pipeline outage exceeding 2 hours',
    'New incident notification requirement and acknowledgment archival rule.',
    'NOTIFY',
    JSON.stringify({ country: 'Bangladesh', industries: ['Financial Technology', 'Digital Payments'] }),
    'Add automated BFIU supervision notification escalation to AML incident runbooks.',
    'Within 2 hours of outage',
    'Event-driven',
    'Platform Security & Compliance',
    JSON.stringify(['Incident runbook update', 'goAML acknowledgment receipts']),
    'BFIU-MC-34/2026 v2 · Section 7.3',
    'High',
    'NEW',
    now,
    now
  );

  // =========================================================================
  // CASE 3: UNCHANGED REGULATORY CHECK (BTRC-DPG-12/2026)
  // =========================================================================
  const btrcV1Text = `Section 3.1 Sovereign Key Custody:
Digital payment providers operating in Bangladesh shall maintain primary PII KMS encryption keys inside Tier-3 data center facilities located in Bangladesh.

Section 3.2 Audit Log Mirroring:
An immutable domestic mirror of all regulatory audit logs shall be retained inside Bangladesh jurisdiction.`;

  const btrcDiff1 = computeStructuredRegulatoryDiff({
    previousText: null,
    newText: btrcV1Text,
    identifier: 'BTRC-DPG-12/2026',
    versionNumber: 1,
  });
  const btrcHash = computeContentHash(btrcV1Text);

  insertDoc.run(
    'rdoc_btrc_dpg12',
    'src_btrc_dpg',
    'Bangladesh',
    'Bangladesh',
    null,
    'BTRC',
    'Digital Payment Gateway Data Localization Directive [DEMO]',
    'Gazette Notice',
    'BTRC-DPG-12/2026',
    JSON.stringify(['Financial Technology', 'Digital Payments']),
    JSON.stringify(['Payment Service Provider', 'Digital Payment Gateway']),
    JSON.stringify(['Cloud Infrastructure', 'Customer PII Storage']),
    JSON.stringify(['Payment Gateway API']),
    JSON.stringify(['Tier-3 domestic facility']),
    JSON.stringify(['Data Localization', 'KMS Custody', 'Audit Logs']),
    'rver_btrc_dpg12_v1',
    1,
    'UNCHANGED',
    '2026-11-05',
    '2027-02-01',
    'https://btrc.gov.bd/directives/dpg122026-demo-fixture',
    now,
    now
  );

  insertVer.run(
    'rver_btrc_dpg12_v1',
    'rdoc_btrc_dpg12',
    'src_btrc_dpg',
    'Bangladesh',
    'BTRC',
    'Digital Payment Gateway Data Localization Directive [DEMO]',
    'Gazette Notice',
    'BTRC-DPG-12/2026',
    '2026-11-05',
    '2027-02-01',
    '2026-11-05T10:00:00.000Z',
    'https://btrc.gov.bd/directives/dpg122026-demo-fixture',
    btrcHash,
    1,
    null,
    null,
    'NEW',
    btrcV1Text,
    JSON.stringify(btrcDiff1.newSections),
    '2026-11-05T10:00:00.000Z'
  );

  db.prepare(`UPDATE regulatory_sources SET last_content_hash = ? WHERE id = ?`).run(btrcHash, 'src_btrc_dpg');
  const btrcReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
    documentId: 'rdoc_btrc_dpg12',
    versionId: 'rver_btrc_dpg12_v1',
    versionNumber: 1,
    regulator: 'BTRC',
    identifier: 'BTRC-DPG-12/2026',
    sections: btrcDiff1.newSections,
  });

  insertObl.run(
    'robl_btrc_kms',
    'rdoc_btrc_dpg12',
    'rver_btrc_dpg12_v1',
    btrcReqIds[0] ?? null,
    null,
    'Bangladesh',
    'BTRC',
    'Maintain primary PII KMS keys and audit mirror inside Bangladesh',
    'Primary PII encryption keys and domestic audit mirror must stay inside Tier-3 facilities in Bangladesh.',
    'PROTECT_DATA',
    JSON.stringify({ country: 'Bangladesh', industries: ['Financial Technology', 'Digital Payments'] }),
    'Ensure primary KMS root keys and audit sink replicate inside Bangladesh Tier-3 node.',
    '2027-02-01',
    'Continuous',
    'Platform Security',
    JSON.stringify(['KMS region attestation', 'Dhaka DR mirror config']),
    'BTRC-DPG-12/2026 v1 · Section 3.1',
    'High',
    'ACTIVE',
    now,
    now
  );

  // =========================================================================
  // CASE 4: NEW MULTI-JURISDICTION REGULATIONS (US NYDFS + EU ESMA)
  // =========================================================================
  const nydfsV1Text = `Section 500.17 Notices to Superintendent:
Covered entities licensed in New York shall notify the NYDFS Superintendent within 72 hours from determining a Cybersecurity Event has occurred, and submit extortion payment notices within 24 hours.`;

  const nydfsDiff1 = computeStructuredRegulatoryDiff({
    previousText: null,
    newText: nydfsV1Text,
    identifier: 'US-NYDFS-500-2026',
    versionNumber: 1,
  });

  insertDoc.run(
    'rdoc_us_nydfs500',
    'src_us_nydfs',
    'United States',
    'United States',
    'New York',
    'NYDFS',
    '23 NYCRR Part 500: Cybersecurity Event & Extortion Notice Rule [DEMO]',
    'Statutory Rule',
    'US-NYDFS-500-2026',
    JSON.stringify(['Financial Services', 'Banking', 'Insurance']),
    JSON.stringify(['NYDFS Licensed Financial Institution']),
    JSON.stringify(['New York Regulated Financial Operations']),
    JSON.stringify(['Banking', 'Insurance', 'Virtual Currency NY']),
    JSON.stringify(['72-hour incident notice', '24-hour extortion notice']),
    JSON.stringify(['Cybersecurity', 'Incident Notification', 'United States']),
    'rver_us_nydfs_v1',
    1,
    'NEW',
    '2026-11-17',
    '2027-01-15',
    'https://www.dfs.ny.gov/industry_guidance/cybersecurity-part500-demo-fixture',
    now,
    now
  );

  insertVer.run(
    'rver_us_nydfs_v1',
    'rdoc_us_nydfs500',
    'src_us_nydfs',
    'United States',
    'NYDFS',
    '23 NYCRR Part 500: Cybersecurity Event & Extortion Notice Rule [DEMO]',
    'Statutory Rule',
    'US-NYDFS-500-2026',
    '2026-11-17',
    '2027-01-15',
    now,
    'https://www.dfs.ny.gov/industry_guidance/cybersecurity-part500-demo-fixture',
    computeContentHash(nydfsV1Text),
    1,
    null,
    null,
    'NEW',
    nydfsV1Text,
    JSON.stringify(nydfsDiff1.newSections),
    now
  );

  const nydfsReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
    documentId: 'rdoc_us_nydfs500',
    versionId: 'rver_us_nydfs_v1',
    versionNumber: 1,
    regulator: 'NYDFS',
    identifier: 'US-NYDFS-500-2026',
    sections: nydfsDiff1.newSections,
  });

  insertChange.run(
    'rchg_us_nydfs_v1',
    'rdoc_us_nydfs500',
    'src_us_nydfs',
    null,
    'rver_us_nydfs_v1',
    'United States',
    'NYDFS',
    'US-NYDFS-500-2026',
    '23 NYCRR Part 500: Cybersecurity Event & Extortion Notice Rule [DEMO]',
    'NEW',
    'High',
    1,
    '2026-11-17',
    nydfsDiff1.summaryText,
    JSON.stringify(nydfsDiff1.items),
    JSON.stringify({
      summary:
        'New US (New York) NYDFS 23 NYCRR Part 500 cybersecurity notice rule ingested requiring 72-hour cybersecurity event reporting and 24-hour extortion payment notification for NYDFS-licensed entities.',
      meaning:
        'Applies strictly to organizations with New York financial licenses/operations; organizations operating solely outside the United States are not in scope.',
      is_obligation_change: true,
      affected_entities: ['NYDFS-Licensed Financial Entities in New York'],
      changed_deadlines: ['72 hours for cybersecurity events', '24 hours for extortion payments'],
      changed_thresholds: [],
      operational_changes: ['Verify whether organization holds NYDFS license or US New York nexus'],
      material_changes: ['New US state cybersecurity notification mandate (Section 500.17)'],
      affected_obligation_types: ['NOTIFY'],
      potential_impact: 'High for US NYDFS covered entities; Not Applicable for Bangladesh-only PSPs.',
      recommended_review: ['Confirm jurisdictional applicability against company operating jurisdictions'],
      citations: [
        { version: 'v1', section: '500.17', excerpt: 'Covered entities licensed in New York shall notify the NYDFS Superintendent within 72 hours' },
      ],
      confidence: 'High',
      insufficient_evidence: false,
      ai_generated: false,
      model_name: 'demo-synthetic-fixture',
    }),
    1,
    'https://www.dfs.ny.gov/industry_guidance/cybersecurity-part500-demo-fixture',
    now
  );

  insertObl.run(
    'robl_us_nydfs_notify',
    'rdoc_us_nydfs500',
    'rver_us_nydfs_v1',
    nydfsReqIds[0] ?? null,
    'rchg_us_nydfs_v1',
    'United States',
    'NYDFS',
    'Notify NYDFS Superintendent within 72 hours of cybersecurity event',
    'Applies exclusively to NYDFS-licensed entities operating in New York State.',
    'NOTIFY',
    JSON.stringify({
      country: 'United States',
      state_province: 'New York',
      industries: ['Financial Services', 'Banking', 'Insurance'],
      company_types: ['NYDFS Licensed Financial Institution'],
    }),
    'Submit electronic cybersecurity event notice via NYDFS portal within 72 hours.',
    'Within 72 hours',
    'Event-driven',
    'Chief Information Security Officer',
    JSON.stringify(['NYDFS filing confirmation']),
    'US-NYDFS-500-2026 v1 · Section 500.17',
    'High',
    'NEW',
    now,
    now
  );

  // Record observability runs demonstrating both a new change detection and an UNCHANGED source check
  const insertRun = db.prepare(
    `INSERT INTO regulatory_ingestion_runs (
      id, source_id, status, documents_fetched, versions_created, changes_detected,
      obligations_extracted, error_message, events_json, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
  );

  insertRun.run(
    'run_demo_bb_mod',
    'src_bb_psd',
    'COMPLETED',
    1,
    1,
    1,
    2,
    JSON.stringify([
      'source check started (BB-PSD-09/2026)',
      'parsing completed',
      'new version detected (v2)',
      'diff completed (3 structured items)',
      'obligation extraction completed (2)',
      'source check completed',
    ]),
    '2026-11-20T08:44:50.000Z',
    '2026-11-20T08:45:00.000Z'
  );

  insertRun.run(
    'run_demo_btrc_unchanged',
    'src_btrc_dpg',
    'UNCHANGED',
    1,
    0,
    0,
    0,
    JSON.stringify([
      'source check started (BTRC-DPG-12/2026)',
      'parsing completed',
      'source unchanged (content hash matched)',
      'source check completed',
    ]),
    '2026-11-20T08:49:55.000Z',
    '2026-11-20T08:50:00.000Z'
  );

  seedApplicabilityDemoRegulations();
}

export function seedApplicabilityDemoRegulations(): void {
  const now = '2026-11-20T09:15:00.000Z';

  // Ensure banking-only regulation (BB-BRPD-14/2026) exists -> demonstrates DOES_NOT_APPLY for non-bank PSPs
  const hasBrpd = db.prepare(`SELECT id FROM regulatory_documents WHERE id = ?`).get('rdoc_bb_brpd14');
  if (!hasBrpd) {
    db.prepare(
      `INSERT OR IGNORE INTO regulatory_sources (
        id, name, jurisdiction, state_province, regulator, source_type, source_url,
        description, active, monitoring_frequency, last_checked_at, last_successful_fetch_at,
        last_content_hash, last_error, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 'circular', ?, ?, 1, 'daily', ?, ?, NULL, NULL, 1, ?, ?)`
    ).run(
      'src_bb_brpd',
      'Bangladesh Bank — BRPD Commercial Banking Circulars [DEMO / SYNTHETIC]',
      'Bangladesh',
      'Bangladesh Bank',
      'https://www.bb.org.bd/mediaroom/circulars/brpd/brpd142026-demo-fixture',
      'Synthetic demo source covering scheduled commercial bank Basel III capital & liquidity rules.',
      now,
      now,
      now,
      now
    );

    const brpdText = `Section 2.1 Applicability Scope (Scheduled Commercial Banks Only):
This Banking Regulation & Policy Department (BRPD) circular applies exclusively to scheduled Commercial Banks operating in Bangladesh. Non-bank Payment Service Providers (PSPs) and mobile wallet operators without a scheduled banking license are excluded from this directive.

Section 2.2 Liquidity Coverage Ratio (LCR):
Scheduled Commercial Banks shall maintain a daily Liquidity Coverage Ratio of at least 110% of 30-day stressed net cash outflows and submit monthly BRPD LCR schedules.`;
    const brpdDiff = computeStructuredRegulatoryDiff({
      previousText: null,
      newText: brpdText,
      identifier: 'BB-BRPD-14/2026',
      versionNumber: 1,
    });

    db.prepare(
      `INSERT INTO regulatory_documents (
        id, source_id, jurisdiction, country, state_province, regulator, title, document_type,
        regulatory_identifier, industry_tags_json, company_types_json, business_activities_json,
        regulated_products_json, thresholds_json, topics_json, current_version_id,
        current_version_number, latest_change_status, publication_date, effective_date,
        source_url, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'NEW', ?, ?, ?, 1, ?, ?)`
    ).run(
      'rdoc_bb_brpd14',
      'src_bb_brpd',
      'Bangladesh',
      'Bangladesh',
      'Bangladesh Bank',
      'BRPD Circular 14/2026: Scheduled Commercial Bank Basel III LCR Mandate [DEMO]',
      'Circular',
      'BB-BRPD-14/2026',
      JSON.stringify(['Banking']),
      JSON.stringify(['Commercial Bank']),
      JSON.stringify(['Deposit Taking', 'Commercial Lending']),
      JSON.stringify(['Core Banking Deposits']),
      JSON.stringify(['LCR >= 110%']),
      JSON.stringify(['Banking', 'Basel III', 'Liquidity Coverage']),
      'rver_bb_brpd14_v1',
      '2026-11-16',
      '2027-01-01',
      'https://www.bb.org.bd/mediaroom/circulars/brpd/brpd142026-demo-fixture',
      now,
      now
    );

    db.prepare(
      `INSERT INTO regulatory_document_versions (
        id, document_id, source_id, jurisdiction, regulator, title, document_type,
        regulatory_identifier, publication_date, effective_date, retrieved_at, source_url,
        content_hash, version_number, previous_version_id, next_version_id, change_status,
        raw_document_location, extracted_text, sections_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, 'NEW', NULL, ?, ?, 'ACTIVE', ?)`
    ).run(
      'rver_bb_brpd14_v1',
      'rdoc_bb_brpd14',
      'src_bb_brpd',
      'Bangladesh',
      'Bangladesh Bank',
      'BRPD Circular 14/2026: Scheduled Commercial Bank Basel III LCR Mandate [DEMO]',
      'Circular',
      'BB-BRPD-14/2026',
      '2026-11-16',
      '2027-01-01',
      now,
      'https://www.bb.org.bd/mediaroom/circulars/brpd/brpd142026-demo-fixture',
      computeContentHash(brpdText),
      brpdText,
      JSON.stringify(brpdDiff.newSections),
      now
    );

    const brpdReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
      documentId: 'rdoc_bb_brpd14',
      versionId: 'rver_bb_brpd14_v1',
      versionNumber: 1,
      regulator: 'Bangladesh Bank',
      identifier: 'BB-BRPD-14/2026',
      sections: brpdDiff.newSections,
    });

    db.prepare(
      `INSERT INTO regulatory_obligations (
        id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
        regulator, title, description, obligation_type, applicability_conditions_json,
        required_action, deadline, frequency, responsible_entity, evidence_required_json,
        source_reference, confidence, change_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'High', 'ACTIVE', ?, ?)`
    ).run(
      'robl_bb_brpd_lcr',
      'rdoc_bb_brpd14',
      'rver_bb_brpd14_v1',
      brpdReqIds[1] ?? brpdReqIds[0] ?? null,
      'Bangladesh',
      'Bangladesh Bank',
      'Maintain 110% Basel III Liquidity Coverage Ratio for Scheduled Commercial Banks',
      'Applies strictly to scheduled Commercial Banks in Bangladesh; non-bank Payment Service Providers are explicitly excluded.',
      'REPORT',
      JSON.stringify({
        country: 'Bangladesh',
        industries: ['Banking'],
        company_types: ['Commercial Bank'],
        exclusions: ['Payment Service Provider', 'Mobile Financial Service'],
        rules: [
          {
            id: 'brpd_jur',
            condition_type: 'JURISDICTION',
            operator: 'IN',
            field_path: 'geography.countries_of_operation',
            expected_value: ['Bangladesh'],
            hard_requirement: true,
            description: 'Operates in Bangladesh',
            source_reference: 'BB-BRPD-14/2026 v1 · Section 2.1',
          },
          {
            id: 'brpd_ind',
            condition_type: 'INDUSTRY',
            operator: 'IN',
            field_path: 'business.industry',
            expected_value: ['Banking'],
            hard_requirement: true,
            description: 'Primary or regulated industry is Banking',
            source_reference: 'BB-BRPD-14/2026 v1 · Section 2.1',
          },
          {
            id: 'brpd_type',
            condition_type: 'COMPANY_TYPE',
            operator: 'IN',
            field_path: 'business.company_type',
            expected_value: ['Commercial Bank'],
            hard_requirement: true,
            description: 'Entity is a Scheduled Commercial Bank',
            source_reference: 'BB-BRPD-14/2026 v1 · Section 2.1',
          },
          {
            id: 'brpd_excl',
            condition_type: 'EXCLUSION',
            operator: 'IN',
            field_path: 'business.company_type',
            expected_value: ['Payment Service Provider', 'Mobile Financial Service'],
            is_exclusion: true,
            hard_requirement: true,
            description: 'Non-bank PSPs and MFS operators are excluded under Section 2.1',
            source_reference: 'BB-BRPD-14/2026 v1 · Section 2.1',
          },
        ],
      }),
      'Compute daily Basel III Liquidity Coverage Ratio >= 110% and file monthly BRPD returns.',
      '2027-01-01',
      'Monthly',
      'Scheduled Commercial Banks',
      JSON.stringify(['BRPD LCR monthly return']),
      'BB-BRPD-14/2026 v1 · Section 2.2',
      now,
      now
    );
  }

  // Ensure Threshold + License gated regulation (BB-PSD-TIER1/2026) exists -> demonstrates INSUFFICIENT_INFORMATION when revenue/license missing
  const hasTier1 = db.prepare(`SELECT id FROM regulatory_documents WHERE id = ?`).get('rdoc_bb_tier1');
  if (!hasTier1) {
    const tier1Text = `Section 5.1 Scope & Revenue Threshold:
Tier-1 Payment Service Providers in Bangladesh with annual gross revenue exceeding BDT 500,000,000 and holding a Tier-1 PSP license shall comply with enhanced escrow reserve and operational resilience stress testing.

Section 5.2 Annual Escrow Buffer Audit:
Covered Tier-1 PSPs shall submit an audited settlement escrow buffer attestation verifying 105% reserve coverage.`;
    const tier1Diff = computeStructuredRegulatoryDiff({
      previousText: null,
      newText: tier1Text,
      identifier: 'BB-PSD-TIER1/2026',
      versionNumber: 1,
    });

    db.prepare(
      `INSERT INTO regulatory_documents (
        id, source_id, jurisdiction, country, state_province, regulator, title, document_type,
        regulatory_identifier, industry_tags_json, company_types_json, business_activities_json,
        regulated_products_json, thresholds_json, topics_json, current_version_id,
        current_version_number, latest_change_status, publication_date, effective_date,
        source_url, is_demo, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'NEW', ?, ?, ?, 1, ?, ?)`
    ).run(
      'rdoc_bb_tier1',
      'src_bb_psd',
      'Bangladesh',
      'Bangladesh',
      'Bangladesh Bank',
      'Circular PSD-TIER1/2026: Tier-1 High-Volume PSP Escrow Reserve Directive [DEMO]',
      'Circular',
      'BB-PSD-TIER1/2026',
      JSON.stringify(['Financial Technology', 'Digital Payments']),
      JSON.stringify(['Payment Service Provider']),
      JSON.stringify(['Digital Payments', 'Mobile Wallet', 'Payment Processing']),
      JSON.stringify(['Settlement Escrow']),
      JSON.stringify(['Annual revenue > BDT 500,000,000', 'Tier-1 PSP license']),
      JSON.stringify(['Escrow Reserve', 'Operational Resilience', 'Tier-1 Threshold']),
      'rver_bb_tier1_v1',
      '2026-11-19',
      '2027-01-15',
      'https://www.bb.org.bd/mediaroom/circulars/psd/psd-tier1-2026-demo-fixture',
      now,
      now
    );

    db.prepare(
      `INSERT INTO regulatory_document_versions (
        id, document_id, source_id, jurisdiction, regulator, title, document_type,
        regulatory_identifier, publication_date, effective_date, retrieved_at, source_url,
        content_hash, version_number, previous_version_id, next_version_id, change_status,
        raw_document_location, extracted_text, sections_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, NULL, 'NEW', NULL, ?, ?, 'ACTIVE', ?)`
    ).run(
      'rver_bb_tier1_v1',
      'rdoc_bb_tier1',
      'src_bb_psd',
      'Bangladesh',
      'Bangladesh Bank',
      'Circular PSD-TIER1/2026: Tier-1 High-Volume PSP Escrow Reserve Directive [DEMO]',
      'Circular',
      'BB-PSD-TIER1/2026',
      '2026-11-19',
      '2027-01-15',
      now,
      'https://www.bb.org.bd/mediaroom/circulars/psd/psd-tier1-2026-demo-fixture',
      computeContentHash(tier1Text),
      tier1Text,
      JSON.stringify(tier1Diff.newSections),
      now
    );

    const tier1ReqIds = regulatoryGraphStore.recordRequirementsAndLineage({
      documentId: 'rdoc_bb_tier1',
      versionId: 'rver_bb_tier1_v1',
      versionNumber: 1,
      regulator: 'Bangladesh Bank',
      identifier: 'BB-PSD-TIER1/2026',
      sections: tier1Diff.newSections,
    });

    db.prepare(
      `INSERT INTO regulatory_obligations (
        id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
        regulator, title, description, obligation_type, applicability_conditions_json,
        required_action, deadline, frequency, responsible_entity, evidence_required_json,
        source_reference, confidence, change_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'High', 'NEW', ?, ?)`
    ).run(
      'robl_bb_tier1_reserve',
      'rdoc_bb_tier1',
      'rver_bb_tier1_v1',
      tier1ReqIds[1] ?? tier1ReqIds[0] ?? null,
      'Bangladesh',
      'Bangladesh Bank',
      'Submit annual Tier-1 PSP 105% settlement escrow buffer audit',
      'Applies only to Bangladesh PSPs exceeding BDT 500,000,000 annual revenue holding a Tier-1 PSP license.',
      'AUDIT',
      JSON.stringify({
        country: 'Bangladesh',
        industries: ['Financial Technology', 'Digital Payments'],
        company_types: ['Payment Service Provider'],
        annual_revenue_gt: 500000000,
        licenses: ['Tier-1 PSP'],
        rules: [
          {
            id: 't1_jur',
            condition_type: 'JURISDICTION',
            operator: 'IN',
            field_path: 'geography.countries_of_operation',
            expected_value: ['Bangladesh'],
            hard_requirement: true,
            description: 'Operates in Bangladesh',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
          {
            id: 't1_ind',
            condition_type: 'INDUSTRY',
            operator: 'IN',
            field_path: 'business.industry',
            expected_value: ['Financial Technology', 'Digital Payments'],
            hard_requirement: true,
            description: 'Industry is Financial Technology or Digital Payments',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
          {
            id: 't1_rev',
            condition_type: 'REVENUE',
            operator: 'GREATER_THAN',
            field_path: 'scale.annual_revenue',
            expected_value: 500000000,
            hard_requirement: true,
            description: 'Annual gross revenue exceeds BDT 500,000,000',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
          {
            id: 't1_lic',
            condition_type: 'LICENSE',
            operator: 'CONTAINS',
            field_path: 'regulatory.licenses',
            expected_value: ['Tier-1 PSP'],
            hard_requirement: true,
            description: 'Holds Tier-1 PSP license',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
        ],
      }),
      'Complete external escrow reserve attestation confirming 105% settlement coverage.',
      '2027-01-15',
      'Annual',
      'Tier-1 Payment Service Providers',
      JSON.stringify(['Audited 105% escrow reserve certificate']),
      'BB-PSD-TIER1/2026 v1 · Section 5.2',
      now,
      now
    );

    // Add a Systemic Assets Audit obligation (assets > BDT 2,000,000,000) so BanglaPay also demonstrates missing-info feedback loop clearly
    db.prepare(
      `INSERT INTO regulatory_obligations (
        id, regulation_id, regulation_version_id, requirement_id, change_id, jurisdiction,
        regulator, title, description, obligation_type, applicability_conditions_json,
        required_action, deadline, frequency, responsible_entity, evidence_required_json,
        source_reference, confidence, change_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Medium', 'NEW', ?, ?)`
    ).run(
      'robl_bb_sys_assets',
      'rdoc_bb_tier1',
      'rver_bb_tier1_v1',
      tier1ReqIds[0] ?? null,
      'Bangladesh',
      'Bangladesh Bank',
      'Conduct semi-annual systemic PSP balance-sheet stress test (Assets > BDT 2B)',
      'Applies to Bangladesh Payment Service Providers whose total balance-sheet assets exceed BDT 2,000,000,000.',
      'CONDUCT_ASSESSMENT',
      JSON.stringify({
        country: 'Bangladesh',
        industries: ['Financial Technology', 'Digital Payments'],
        assets_gt: 2000000000,
        rules: [
          {
            id: 'sys_jur',
            condition_type: 'JURISDICTION',
            operator: 'IN',
            field_path: 'geography.countries_of_operation',
            expected_value: ['Bangladesh'],
            hard_requirement: true,
            description: 'Operates in Bangladesh',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
          {
            id: 'sys_ind',
            condition_type: 'INDUSTRY',
            operator: 'IN',
            field_path: 'business.industry',
            expected_value: ['Financial Technology', 'Digital Payments'],
            hard_requirement: true,
            description: 'Industry is Financial Technology or Digital Payments',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
          {
            id: 'sys_assets',
            condition_type: 'ASSETS',
            operator: 'GREATER_THAN',
            field_path: 'scale.assets',
            expected_value: 2000000000,
            hard_requirement: true,
            description: 'Total assets exceed BDT 2,000,000,000',
            source_reference: 'BB-PSD-TIER1/2026 v1 · Section 5.1',
          },
        ],
      }),
      'Execute semi-annual liquidity & settlement stress test and file summary with Bangladesh Bank PSD.',
      '2027-02-28',
      'Semi-Annual',
      'Systemic Payment Service Providers',
      JSON.stringify(['Stress test model report']),
      'BB-PSD-TIER1/2026 v1 · Section 5.1',
      now,
      now
    );
  }
}

