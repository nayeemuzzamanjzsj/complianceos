import crypto from 'node:crypto';
import { db } from './db.ts';
import { hashPassword } from './services/auth.ts';
import { seedGlobalRegulatoryIntelligence } from './services/regulatorySeed.ts';
import { getCompanyProfile, saveCompanyProfile } from './services/companyProfile.ts';
import { recalculateAllObligationsForOrg } from './services/applicabilityEngine.ts';

function sha256(val: string): string {
  return crypto.createHash('sha256').update(val).digest('hex').slice(0, 16);
}

export function seedCompanyProfilesAndApplicability(): void {
  const demoPasswordSecret = process.env.DEMO_USER_PASSWORD?.trim();
  const demoPassHash = hashPassword(demoPasswordSecret || crypto.randomBytes(24).toString('hex'));

  // Seed DeltaPay Ltd. synthetic demo company if missing (showcases APPLIES, DOES_NOT_APPLY, and INSUFFICIENT_INFORMATION cleanly)
  const existingDelta = db.prepare(`SELECT id FROM organizations WHERE id = ?`).get('org_deltapay');
  if (!existingDelta) {
    const now = '2026-11-20T09:30:00.000Z';
    db.prepare(
      `INSERT INTO organizations (
        id, name, country, industry, size, operating_jurisdictions, business_description, onboarding_completed, is_demo, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
    ).run(
      'org_deltapay',
      'DeltaPay Ltd.',
      'Bangladesh',
      'Financial Technology',
      '220 employees',
      JSON.stringify(['Bangladesh']),
      'Licensed Payment Service Provider in Bangladesh operating Digital payments and Mobile wallet infrastructure.',
      now
    );

    db.prepare(
      `INSERT OR IGNORE INTO users (id, organization_id, full_name, email, password_hash, role, department, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'compliance_officer', 'Risk & Compliance', 'Active', ?)`
    ).run('usr_deltapay_nadia', 'org_deltapay', 'Nadia Karim', 'deltapay@complianceos.local', demoPassHash, now);

    db.prepare(
      `INSERT OR IGNORE INTO company_profiles (organization_id, business_json, data_json, infrastructure_json, compliance_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'org_deltapay',
      JSON.stringify({
        products: ['DeltaPay Mobile Wallet', 'Merchant QR Gateway'],
        businessActivities: ['Digital payments', 'Mobile wallet', 'Payment processing'],
      }),
      JSON.stringify({ categories: ['Personal Data', 'Financial Data', 'KYC Records'] }),
      JSON.stringify({ cloudProviders: ['AWS ap-southeast-1', 'Dhaka Local Node'], criticalSystems: ['DeltaPay Core Wallet API'] }),
      JSON.stringify({ regulators: ['Bangladesh Bank', 'BFIU'], certifications: ['PCI-DSS v4.0'] }),
      now
    );
  }

  // Ensure structured profile snapshots exist for BanglaPay and DeltaPay
  const banglaRow = db.prepare(`SELECT structured_profile_json FROM company_profiles WHERE organization_id = ?`).get('org_banglapay') as any;
  if (banglaRow && !banglaRow.structured_profile_json) {
    saveCompanyProfile({
      orgId: 'org_banglapay',
      structuredPatch: {
        identity: {
          legal_name: 'BanglaPay Technologies Ltd.',
          trading_name: 'BanglaPay',
          registration_number: 'RJSC-C-149820/2021',
          country: 'Bangladesh',
          headquarters_location: 'Dhaka, Bangladesh',
        },
        business: {
          industry: 'Financial Technology / Digital Payments',
          business_activities: ['Digital payments', 'Mobile wallet', 'Payment processing', 'e-KYC Onboarding'],
          products_services: ['BanglaPay Consumer Wallet', 'Merchant Settlement API', 'Instant Bank Transfer Rail'],
          business_model: 'B2C Mobile Wallet & B2B Payment Processing',
          company_type: 'Payment Service Provider',
        },
        scale: {
          employee_count: 500,
          annual_revenue: 1200000000,
          annual_revenue_currency: 'BDT',
          assets: 'UNKNOWN',
          operating_regions: ['Bangladesh'],
        },
        regulatory: {
          regulated_industries: ['Financial Technology', 'Digital Payments'],
          licenses: ['Licensed Payment Service Provider (PSP)', 'Tier-1 PSP'],
          regulatory_status: 'Licensed PSP regulated by Bangladesh Bank & BFIU',
          regulated_products: ['Mobile Wallet', 'Merchant Settlement API'],
          data_processing_activities: ['Personal Data', 'Financial Data', 'KYC & NID Biometrics'],
        },
        geography: {
          countries_of_operation: ['Bangladesh'],
          states_provinces_regions: ['Dhaka Division', 'Chattogram Division'],
          customer_locations: ['Bangladesh'],
          data_storage_locations: ['Bangladesh (Dhaka DR)', 'Singapore (AWS ap-southeast-1)'],
        },
        technology: {
          cloud_providers: ['AWS (ap-southeast-1)', 'Dhaka On-Premises DR'],
          critical_systems: ['Transaction DB', 'KYC Document Vault', 'STR Screening Pipeline'],
          data_types_processed: ['Personal Data', 'Financial Data', 'KYC Records', 'Biometric Verification Logs'],
          payment_processing: true,
          third_party_processors: ['HashiCorp Vault', 'AWS KMS'],
        },
        risk_context: {
          risk_profile: 'High',
          sensitive_data_handled: true,
          critical_infrastructure: true,
          public_company_status: false,
          financial_institution_status: true,
        },
      },
      actorName: 'System Seed',
      actorRole: 'System',
      changeSummary: 'Initial normalized BanglaPay profile v2 (Tier-1 PSP, assets UNKNOWN)',
    });
  }

  const deltaRow = db.prepare(`SELECT structured_profile_json FROM company_profiles WHERE organization_id = ?`).get('org_deltapay') as any;
  if (deltaRow && !deltaRow.structured_profile_json) {
    saveCompanyProfile({
      orgId: 'org_deltapay',
      structuredPatch: {
        identity: {
          legal_name: 'DeltaPay Ltd.',
          trading_name: 'DeltaPay',
          registration_number: 'RJSC-C-162311/2023',
          country: 'Bangladesh',
          headquarters_location: 'Dhaka, Bangladesh',
        },
        business: {
          industry: 'Financial Technology',
          business_activities: ['Digital payments', 'Mobile wallet'],
          products_services: ['DeltaPay Mobile Wallet', 'Merchant QR Gateway'],
          business_model: 'Digital wallet and retail QR payment service provider',
          company_type: 'Payment Service Provider',
        },
        scale: {
          employee_count: 220,
          annual_revenue: 'UNKNOWN',
          annual_revenue_currency: 'BDT',
          assets: 'UNKNOWN',
          operating_regions: ['Bangladesh'],
        },
        regulatory: {
          regulated_industries: ['Financial Technology', 'Digital Payments'],
          licenses: ['Bangladesh Bank PSP License'],
          regulatory_status: 'Licensed Payment Service Provider',
          regulated_products: ['Mobile Wallet'],
          data_processing_activities: ['Personal Data', 'Financial Data', 'KYC Records'],
        },
        geography: {
          countries_of_operation: ['Bangladesh'],
          states_provinces_regions: ['Dhaka Division'],
          customer_locations: ['Bangladesh'],
          data_storage_locations: ['Bangladesh'],
        },
        technology: {
          cloud_providers: ['AWS (ap-southeast-1)', 'Dhaka Local Node'],
          critical_systems: ['DeltaPay Core Wallet API', 'DeltaPay Ledger DB'],
          data_types_processed: ['Personal Data', 'Financial Data', 'KYC Records'],
          payment_processing: true,
          third_party_processors: ['AWS KMS'],
        },
        risk_context: {
          risk_profile: 'High',
          sensitive_data_handled: true,
          critical_infrastructure: true,
          public_company_status: false,
          financial_institution_status: true,
        },
      },
      actorName: 'System Seed',
      actorRole: 'System',
      changeSummary: 'Initial DeltaPay Ltd. profile (revenue & Tier-1 status pending disclosure)',
    });
  }

  // Ensure initial deterministic assessments exist for every current obligation on both demo orgs
  for (const orgId of ['org_banglapay', 'org_deltapay']) {
    getCompanyProfile(orgId);
    const missingObls = db
      .prepare(
        `SELECT ro.id
         FROM regulatory_obligations ro
         JOIN regulatory_documents rd ON rd.id = ro.regulation_id
         WHERE ro.regulation_version_id = rd.current_version_id
           AND ro.id NOT IN (
             SELECT obligation_id FROM obligation_applicability_assessments WHERE organization_id = ?
           )`
      )
      .all(orgId) as Array<{ id: string }>;
    if (missingObls.length > 0) {
      void recalculateAllObligationsForOrg(orgId, {
        useAi: false,
        onlyObligationIds: missingObls.map((m) => m.id),
      });
    }
  }
}

export function seedDemoData(): void {
  seedGlobalRegulatoryIntelligence();
  const existing = db.prepare(`SELECT id FROM organizations WHERE id = ?`).get('org_banglapay');
  if (existing) {
    const demoPasswordSecret = process.env.DEMO_USER_PASSWORD?.trim();
    if (demoPasswordSecret) {
      const updatedHash = hashPassword(demoPasswordSecret);
      db.prepare(`UPDATE users SET password_hash = ? WHERE organization_id = ?`).run(
        updatedHash,
        'org_banglapay'
      );
    }
    seedCompanyProfilesAndApplicability();
    return;
  }

  const now = '2026-11-21T10:42:00.000Z';

  // 1. Primary Demo Organization: BanglaPay Technologies Ltd.
  db.prepare(
    `INSERT INTO organizations (
      id, name, country, industry, size, operating_jurisdictions, business_description, onboarding_completed, is_demo, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(
    'org_banglapay',
    'BanglaPay Technologies Ltd.',
    'Bangladesh',
    'Financial Technology / Digital Payments',
    '500 employees',
    JSON.stringify(['Bangladesh']),
    'Licensed Payment Service Provider (PSP) operating mobile wallet, merchant settlement, and domestic P2P digital payment infrastructure across Bangladesh.',
    '2026-01-15T08:00:00.000Z'
  );

  // Additional fictional benchmark orgs for Platform Admin metrics (isolated tenants)
  db.prepare(
    `INSERT INTO organizations (id, name, country, industry, size, operating_jurisdictions, business_description, onboarding_completed, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(
    'org_dhakamerchant',
    'DhakaPay Merchant Solutions Ltd.',
    'Bangladesh',
    'Merchant Acquiring & POS',
    '180 employees',
    JSON.stringify(['Bangladesh']),
    'QR and POS payment aggregator serving retail merchants across Dhaka and Chattogram.',
    '2026-03-10T09:30:00.000Z'
  );

  db.prepare(
    `INSERT INTO organizations (id, name, country, industry, size, operating_jurisdictions, business_description, onboarding_completed, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`
  ).run(
    'org_padmainsure',
    'Padma Digital Insurance Ltd.',
    'Bangladesh',
    'InsurTech',
    '310 employees',
    JSON.stringify(['Bangladesh']),
    'Micro-insurance and digital policy underwriting platform.',
    '2026-05-22T11:15:00.000Z'
  );

  // 2. Demo Users
  const demoPasswordSecret = process.env.DEMO_USER_PASSWORD?.trim();
  const demoPassHash = hashPassword(demoPasswordSecret || crypto.randomBytes(24).toString('hex'));

  const insertUser = db.prepare(
    `INSERT INTO users (id, organization_id, full_name, email, password_hash, role, department, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Active', ?)`
  );
  insertUser.run('usr_tariq', 'org_banglapay', 'Tariq Rahman', 'demo@complianceos.local', demoPassHash, 'compliance_officer', 'Compliance', '2026-01-15T08:05:00.000Z');
  insertUser.run('usr_nusrat', 'org_banglapay', 'Nusrat Jahan', 'nusrat.admin@banglapay.example', demoPassHash, 'org_admin', 'Executive & Governance', '2026-01-15T08:06:00.000Z');
  insertUser.run('usr_rafiq', 'org_banglapay', 'Rafiq Ahmed', 'rafiq.eng@banglapay.example', demoPassHash, 'engineering', 'Core Platform Engineering', '2026-01-16T09:00:00.000Z');
  insertUser.run('usr_farhana', 'org_banglapay', 'Farhana Kabir', 'farhana.audit@banglapay.example', demoPassHash, 'auditor', 'External Audit', '2026-02-01T10:00:00.000Z');
  insertUser.run('usr_bench1', 'org_dhakamerchant', 'Kamrul Hasan', 'kamrul@dhakamerchant.example', demoPassHash, 'org_admin', 'Operations', '2026-03-10T09:40:00.000Z');
  insertUser.run('usr_bench2', 'org_padmainsure', 'Sadia Chowdhury', 'sadia@padmainsure.example', demoPassHash, 'compliance_officer', 'Risk & Compliance', '2026-05-22T11:25:00.000Z');

  // 3. Company Profile for BanglaPay
  db.prepare(
    `INSERT INTO company_profiles (organization_id, business_json, data_json, infrastructure_json, compliance_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    'org_banglapay',
    JSON.stringify({
      products: ['BanglaPay Consumer Wallet', 'Merchant Settlement API', 'Instant Bank Transfer Rail'],
      services: ['Digital Payments', 'e-KYC Onboarding', 'B2B Payouts'],
      businessActivities: ['Payment Processing', 'Stored Value Issuance', 'Cross-Bank Settlement'],
      customerTypes: ['Retail Consumers', 'SME Merchants', 'Enterprise Billers'],
    }),
    JSON.stringify({
      categories: ['Personal Data', 'Financial Data', 'KYC & National ID Records', 'Transaction Ledgers'],
      crossBorderTransfer: false,
      monthlyTransactions: '18.4M transactions/month',
    }),
    JSON.stringify({
      cloudProviders: ['AWS (ap-southeast-1)', 'On-Premise Dhaka DR Node'],
      databases: ['Transaction DB (PostgreSQL 16)', 'KYC Document Vault (S3 + KMS)'],
      criticalSystems: ['Core Ledger API', 'e-KYC Verification Engine', 'STR Screening Pipeline'],
      securitySystems: ['HashiCorp Vault', 'AWS KMS', 'CloudTrail Immutable Audit Sink'],
    }),
    JSON.stringify({
      regulators: ['Bangladesh Bank', 'BFIU (Bangladesh Financial Intelligence Unit)', 'BTRC'],
      certifications: ['PCI-DSS v4.0', 'ISO/IEC 27001:2022'],
      frameworks: ['Bangladesh Bank Payment Systems Regulations', 'AML/CFT Master Directives'],
    }),
    now
  );

  // 4. Systems
  const insertSys = db.prepare(
    `INSERT INTO systems (id, organization_id, name, category, provider, data_classification, owner_department)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insertSys.run('sys_txdb', 'org_banglapay', 'Transaction DB', 'Relational Ledger Database', 'AWS RDS PostgreSQL', 'Regulated Financial Records', 'Core Platform Engineering');
  insertSys.run('sys_kycvault', 'org_banglapay', 'KYC Document Vault', 'Encrypted Object Storage', 'AWS S3 + KMS', 'Sensitive PII & NID Biometrics', 'Identity & Security');
  insertSys.run('sys_str', 'org_banglapay', 'STR Screening Pipeline', 'AML Event Streaming', 'Kafka + Flink', 'AML Transaction Telemetry', 'Risk Engineering');
  insertSys.run('sys_gateway', 'org_banglapay', 'Payment Gateway API', 'Public API Edge', 'Kubernetes / Envoy', 'Payment Card & Token Data', 'Platform Security');

  // 5. Documents + Document Chunks
  const insertDoc = db.prepare(
    `INSERT INTO documents (
      id, organization_id, filename, mime_type, size_bytes, classification, status, version, source, owner_name, storage_path, extracted_text, summary, chunk_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'Processed', ?, 'Internal Upload', ?, NULL, ?, ?, ?, ?)`
  );
  const insertChunk = db.prepare(
    `INSERT INTO document_chunks (id, document_id, organization_id, chunk_index, content, keywords) VALUES (?, ?, ?, ?, ?, ?)`
  );

  const doc1Text = `BANGLAPAY TECHNOLOGIES LTD — DATA RETENTION & ARCHIVAL POLICY (v2.1).
Section 4.1 Customer KYC Records: All customer onboarding files, NID verifications, and account agreements are retained for 3 years following account closure.
Section 4.2 Transaction Ledgers: Settlement and P2P ledger records are archived in Transaction DB hot storage for 18 months and cold archival for 3 years total.
Section 5.0 Audit Reviews: Annual policy review performed by Compliance Officer.`;

  insertDoc.run(
    'doc_ret_policy',
    'org_banglapay',
    'BanglaPay_Data_Retention_Policy_v2.1.pdf',
    'application/pdf',
    428190,
    'Policy',
    'v2.1',
    'Tariq Rahman',
    doc1Text,
    'Internal policy governing retention durations for customer KYC dossiers and transaction ledgers (currently specifies 3-year retention).',
    2,
    '2026-09-12T10:15:00.000Z'
  );
  insertChunk.run('chk_1', 'doc_ret_policy', 'org_banglapay', 0, doc1Text, 'retention kyc ledger 3 years archival transaction db');

  const doc2Text = `BANGLAPAY KYC LIFECYCLE & BIOMETRIC VERIFICATION SOP (v1.4).
Applies to BanglaPay Consumer Wallet and Merchant Onboarding flows. Biometric and NID verification logs are stored in KYC Document Vault with 3-year lifecycle expiry rule in S3.`;
  insertDoc.run(
    'doc_kyc_sop',
    'org_banglapay',
    'KYC_Lifecycle_Verification_SOP_v1.4.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    215400,
    'SOP',
    'v1.4',
    'Tariq Rahman',
    doc2Text,
    'Standard operating procedure detailing e-KYC biometric capture and KYC Document Vault S3 lifecycle rules.',
    1,
    '2026-10-03T14:20:00.000Z'
  );
  insertChunk.run('chk_2', 'doc_kyc_sop', 'org_banglapay', 0, doc2Text, 'kyc biometric vault s3 lifecycle 3 years');

  const doc3Text = `BANGLAPAY INFORMATION SECURITY & API ACCESS CONTROL MATRIX (v3.0).
Covers PCI-DSS v4.0 and ISO 27001 controls: TLS 1.3 enforcement, quarterly key rotation, MFA for privileged DB access, and CloudTrail log integrity.`;
  insertDoc.run(
    'doc_infosec',
    'org_banglapay',
    'InfoSec_Control_Matrix_v3.0.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    312040,
    'Control Matrix',
    'v3.0',
    'Rafiq Ahmed',
    doc3Text,
    'Enterprise control matrix covering MFA, key rotation, immutable logging, and PCI-DSS v4.0 mappings.',
    1,
    '2026-10-18T11:00:00.000Z'
  );
  insertChunk.run('chk_3', 'doc_infosec', 'org_banglapay', 0, doc3Text, 'mfa key rotation tls immutable audit pci iso27001');

  const doc4Text = `AML/CFT TRANSACTION MONITORING & STR ESCALATION MANUAL (v2.0).
Defines automated threshold alerts for high-velocity wallet transfers and daily batch STR filing workflow to BFIU goAML portal.`;
  insertDoc.run(
    'doc_aml_manual',
    'org_banglapay',
    'AML_CFT_Monitoring_Manual_v2.0.pdf',
    'application/pdf',
    540210,
    'Compliance Manual',
    'v2.0',
    'Tariq Rahman',
    doc4Text,
    'Defines automated transaction monitoring rules and BFIU Suspicious Transaction Report filing SLAs.',
    1,
    '2026-11-01T09:45:00.000Z'
  );
  insertChunk.run('chk_4', 'doc_aml_manual', 'org_banglapay', 0, doc4Text, 'aml cft bfiu str goaml transaction monitoring');

  // 6. Regulations (4 requiring attention + 1 dismissed non-applicable)
  const insertReg = db.prepare(
    `INSERT INTO regulations (
      id, organization_id, code, title, regulator, jurisdiction, source_url, publication_date, effective_date,
      severity, applicability_status, applicability_confidence, status, current_version, summary, content_hash, retrieved_at, is_demo_seeded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  );

  // Primary Demo Regulation
  insertReg.run(
    'reg_bb_retention',
    'org_banglapay',
    'BB-PSD-09/2026',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive',
    'Bangladesh Bank',
    'Bangladesh',
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    '2026-11-18',
    '2026-12-31',
    'High',
    'Applicable',
    'High',
    'Action Required',
    2,
    'Mandates increasing minimum retention of customer KYC dossiers, biometric verification logs, and core transaction ledgers from 3 years to 5 years in tamper-evident immutable storage.',
    sha256('BB-PSD-09/2026-v2'),
    now
  );

  insertReg.run(
    'reg_bfiu_str',
    'org_banglapay',
    'BFIU-MC-34/2026',
    'Master Circular 34/2026: Real-Time Suspicious Transaction Reporting Thresholds',
    'BFIU',
    'Bangladesh',
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture',
    '2026-11-19',
    '2026-12-15',
    'Critical',
    'Applicable',
    'High',
    'Action Required',
    2,
    'Lowers structured cash-in/wallet aggregation alert window from 24 hours to 4 hours and requires automated goAML XML export within 12 hours of trigger.',
    sha256('BFIU-MC-34/2026-v2'),
    now
  );

  insertReg.run(
    'reg_bb_ict',
    'org_banglapay',
    'BB-ICT-4.2/2026',
    'ICT Security Guideline v4.2: Hardware MFA & 90-Day API Credential Rotation',
    'Bangladesh Bank',
    'Bangladesh',
    'https://www.bb.org.bd/mediaroom/guidelines/ict-v42-demo-fixture',
    '2026-11-10',
    '2027-01-15',
    'High',
    'Applicable',
    'High',
    'In Progress',
    2,
    'Requires FIDO2/hardware MFA for all production database administrators and enforces 90-day automated rotation for inter-bank settlement API credentials.',
    sha256('BB-ICT-4.2/2026-v2'),
    now
  );

  insertReg.run(
    'reg_btrc_loc',
    'org_banglapay',
    'BTRC-DPG-12/2026',
    'Digital Payment Gateway Data Localization & Sovereign Audit Log Directive',
    'BTRC',
    'Bangladesh',
    'https://btrc.gov.bd/directives/dpg122026-demo-fixture',
    '2026-11-05',
    '2027-02-01',
    'Medium',
    'Applicable',
    'Medium',
    'Action Required',
    1,
    'Requires primary customer PII encryption keys and domestic audit log mirrors to remain hosted inside Bangladesh tier-3 data centers.',
    sha256('BTRC-DPG-12/2026-v1'),
    now
  );

  insertReg.run(
    'reg_eu_mica',
    'org_banglapay',
    'EU-MICA-2026/88',
    'ESMA Technical Standard on Crypto-Asset Custody Reserve Segregation',
    'ESMA',
    'European Union',
    'https://eur-lex.europa.eu/demo-mica-2026-88',
    '2026-10-28',
    '2027-01-01',
    'Low',
    'Not Applicable',
    'High',
    'Dismissed',
    1,
    'Applies to EU-licensed Crypto-Asset Service Providers (CASPs). Dismissed automatically based on BanglaPay jurisdiction (Bangladesh only) and non-crypto business activities.',
    sha256('EU-MICA-2026/88-v1'),
    now
  );

  // 7. Regulation Versions (Before / After Diff)
  const insertVer = db.prepare(
    `INSERT INTO regulation_versions (
      id, regulation_id, organization_id, version_number, published_at, effective_date, raw_text,
      diff_previous_text, diff_new_text, diff_highlights_json, content_hash, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertVer.run(
    'ver_bb_ret_2',
    'reg_bb_retention',
    'org_banglapay',
    2,
    '2026-11-18',
    '2026-12-31',
    'Circular PSD-09/2026 Clause 4.2 (Amended): Payment Service Providers and Mobile Financial Service operators shall retain all customer KYC dossiers, biometric verification logs, and core settlement transaction records for a minimum period of 5 years in tamper-evident immutable storage, with quarterly retention audit attestations.',
    'Payment Service Providers shall retain customer onboarding KYC records and digital transaction ledgers for a minimum period of 3 years from account closure or transaction settlement.',
    'Payment Service Providers and Mobile Financial Service operators shall retain all customer KYC dossiers, biometric verification logs, and core settlement transaction records for a minimum period of 5 years in tamper-evident immutable storage, with quarterly retention audit attestations.',
    JSON.stringify([
      { type: 'modified', previous: '3 years', current: '5 years' },
      { type: 'added', previous: '', current: 'biometric verification logs' },
      { type: 'added', previous: '', current: 'in tamper-evident immutable storage, with quarterly retention audit attestations' },
    ]),
    sha256('BB-PSD-09/2026-v2'),
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture'
  );

  insertVer.run(
    'ver_bfiu_2',
    'reg_bfiu_str',
    'org_banglapay',
    2,
    '2026-11-19',
    '2026-12-15',
    'Master Circular 34/2026 Section 7: Electronic wallet operators must detect split-deposit structuring across a rolling 4-hour window and submit structured goAML XML reports within 12 hours of alert escalation.',
    'Reporting entities shall evaluate split-deposit structuring over a 24-hour calendar window and submit STR filings within 48 hours of internal investigation closure.',
    'Reporting entities shall evaluate split-deposit structuring over a rolling 4-hour window and submit automated goAML XML STR filings within 12 hours of alert escalation.',
    JSON.stringify([
      { type: 'modified', previous: '24-hour calendar window', current: 'rolling 4-hour window' },
      { type: 'modified', previous: 'within 48 hours', current: 'within 12 hours of alert escalation' },
    ]),
    sha256('BFIU-MC-34/2026-v2'),
    'https://www.bb.org.bd/bfiu/circulars/mc342026-demo-fixture'
  );

  insertVer.run(
    'ver_bb_ict_2',
    'reg_bb_ict',
    'org_banglapay',
    2,
    '2026-11-10',
    '2027-01-15',
    'ICT Security Guideline v4.2 Clause 11: Production database privileged sessions require phishing-resistant FIDO2 hardware MFA. Inter-bank API keys must rotate automatically every 90 days.',
    'Privileged database access requires two-factor authentication and annual API credential rotation.',
    'Privileged database access requires phishing-resistant FIDO2 hardware MFA and automated 90-day API credential rotation.',
    JSON.stringify([
      { type: 'modified', previous: 'two-factor authentication', current: 'phishing-resistant FIDO2 hardware MFA' },
      { type: 'modified', previous: 'annual API credential rotation', current: 'automated 90-day API credential rotation' },
    ]),
    sha256('BB-ICT-4.2/2026-v2'),
    'https://www.bb.org.bd/mediaroom/guidelines/ict-v42-demo-fixture'
  );

  insertVer.run(
    'ver_btrc_1',
    'reg_btrc_loc',
    'org_banglapay',
    1,
    '2026-11-05',
    '2027-02-01',
    'BTRC Directive 12/2026: Digital payment providers must maintain a sovereign audit log mirror and primary PII KMS custody inside Tier-3 facilities located in Bangladesh.',
    'No prior sovereign KMS mirror mandate existed for regional cloud deployments.',
    'Maintain a sovereign audit log mirror and primary PII KMS custody inside Tier-3 facilities located in Bangladesh.',
    JSON.stringify([
      { type: 'added', previous: '', current: 'sovereign audit log mirror and primary PII KMS custody inside Tier-3 facilities located in Bangladesh' },
    ]),
    sha256('BTRC-DPG-12/2026-v1'),
    'https://btrc.gov.bd/directives/dpg122026-demo-fixture'
  );

  insertVer.run(
    'ver_eu_mica_1',
    'reg_eu_mica',
    'org_banglapay',
    1,
    '2026-10-28',
    '2027-01-01',
    'ESMA Technical Standard: Applies strictly to EU-authorized Crypto-Asset Service Providers holding client digital assets.',
    'Draft consultation text.',
    'Applies strictly to EU-authorized Crypto-Asset Service Providers holding client digital assets.',
    JSON.stringify([]),
    sha256('EU-MICA-2026/88-v1'),
    'https://eur-lex.europa.eu/demo-mica-2026-88'
  );

  // 8. Applicability Assessments
  const insertApp = db.prepare(
    `INSERT INTO applicability_assessments (
      id, organization_id, regulation_id, verdict, confidence, summary, profile_reasons_json, citations_json, is_ai_generated, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );

  insertApp.run(
    'app_bb_ret',
    'org_banglapay',
    'reg_bb_retention',
    'Applicable',
    'High',
    'BanglaPay Technologies Ltd. is a Bangladesh Bank-licensed Payment Service Provider processing regulated KYC dossiers and digital transaction ledgers, bringing it directly within Circular PSD-09/2026 scope.',
    JSON.stringify([
      { fact: 'Company operates in Bangladesh', matched: true, explanation: 'Primary jurisdiction is Bangladesh (Dhaka HQ & DR).' },
      { fact: 'Company operates in Financial Technology / Digital Payments', matched: true, explanation: 'Licensed PSP operating Consumer Wallet & Merchant Settlement API.' },
      { fact: 'Company handles regulated financial & KYC records', matched: true, explanation: 'Stores Financial Data, KYC & NID Records in Transaction DB & KYC Vault.' },
      { fact: 'Internal policy currently specifies 3-year retention', matched: true, explanation: 'BanglaPay_Data_Retention_Policy_v2.1.pdf Section 4.1–4.2 sets 3 years, below the new 5-year mandate.' },
    ]),
    JSON.stringify([
      { source: 'Bangladesh Bank Circular PSD-09/2026 (Demo Seed)', clause: 'Clause 4.2', excerpt: 'retain all customer KYC dossiers, biometric verification logs, and core settlement transaction records for a minimum period of 5 years' },
      { source: 'BanglaPay_Data_Retention_Policy_v2.1.pdf', clause: 'Section 4.1 & 4.2', excerpt: 'retained for 3 years following account closure or transaction settlement' },
    ]),
    now
  );

  insertApp.run(
    'app_bfiu_str',
    'org_banglapay',
    'reg_bfiu_str',
    'Applicable',
    'High',
    'BanglaPay operates a stored-value wallet and P2P payment rail regulated by BFIU AML/CFT Master Directives.',
    JSON.stringify([
      { fact: 'Regulator list includes BFIU', matched: true, explanation: 'Subject to BFIU reporting obligations via goAML.' },
      { fact: 'Processes 18.4M monthly wallet transactions', matched: true, explanation: 'STR Screening Pipeline requires rolling 4-hour velocity threshold update.' },
    ]),
    JSON.stringify([
      { source: 'BFIU Master Circular 34/2026 (Demo Seed)', clause: 'Section 7', excerpt: 'rolling 4-hour window and submit automated goAML XML STR filings within 12 hours' },
    ]),
    now
  );

  insertApp.run(
    'app_eu_mica',
    'org_banglapay',
    'reg_eu_mica',
    'Not Applicable',
    'High',
    'BanglaPay operates exclusively in Bangladesh and does not provide crypto-asset custody or EU financial services.',
    JSON.stringify([
      { fact: 'Operating jurisdictions exclude European Union', matched: false, explanation: 'Jurisdiction is Bangladesh only.' },
      { fact: 'No crypto-asset custody activities', matched: false, explanation: 'Products cover fiat BDT wallet and merchant settlement only.' },
    ]),
    JSON.stringify([
      { source: 'ESMA Technical Standard 2026/88 (Demo Seed)', clause: 'Article 1', excerpt: 'Applies strictly to EU-authorized Crypto-Asset Service Providers' },
    ]),
    now
  );

  // 9. Obligations, Controls, Policies for the primary demo story
  const insertObl = db.prepare(
    `INSERT INTO obligations (id, organization_id, regulation_id, code, title, description, requirement_ref, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertObl.run('obl_ret_1', 'org_banglapay', 'reg_bb_retention', 'OBL-RET-01', '5-Year Customer KYC & Biometric Log Retention', 'Retain all customer KYC dossiers and biometric verification logs for at least 5 years post-closure.', 'PSD-09/2026 §4.2(a)', 'Gap Identified');
  insertObl.run('obl_ret_2', 'org_banglapay', 'reg_bb_retention', 'OBL-RET-02', '5-Year Immutable Transaction Ledger Archival', 'Archive core settlement and wallet transaction ledgers in tamper-evident WORM storage for 5 years.', 'PSD-09/2026 §4.2(b)', 'Gap Identified');
  insertObl.run('obl_ret_3', 'org_banglapay', 'reg_bb_retention', 'OBL-RET-03', 'Quarterly Retention Audit Attestation', 'Execute and record quarterly automated retention integrity attestations.', 'PSD-09/2026 §4.2(c)', 'Gap Identified');
  insertObl.run('obl_str_1', 'org_banglapay', 'reg_bfiu_str', 'OBL-AML-01', '4-Hour Rolling Structuring Detection & 12h STR SLA', 'Detect split-deposit structuring over 4-hour rolling window and export goAML XML within 12h.', 'BFIU-MC-34 §7', 'Action Required');
  insertObl.run('obl_ict_1', 'org_banglapay', 'reg_bb_ict', 'OBL-SEC-01', 'Hardware FIDO2 MFA & 90-Day Key Rotation', 'Enforce hardware MFA on production DBs and 90-day settlement key rotation.', 'BB-ICT-4.2 §11', 'In Progress');

  const insertCtrl = db.prepare(
    `INSERT INTO controls (id, organization_id, code, title, description, owner_department, status, verification_status, last_verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertCtrl.run('ctrl_ret_ledger', 'org_banglapay', 'CTRL-RET-01', '5-Year Transaction Ledger Archival Control', 'Automated PostgreSQL partition archival to immutable S3 Object Lock (COMPLIANCE mode, 1,825 days).', 'Core Platform Engineering', 'Requires Update', 'Pending Verification', null);
  insertCtrl.run('ctrl_ret_kyc', 'org_banglapay', 'CTRL-KYC-04', 'Immutable KYC Dossier & Biometric Storage Control', 'S3 Object Lock & KMS encryption lifecycle rule retaining KYC dossiers for 5 years.', 'Identity & Security', 'Requires Update', 'Pending Verification', null);
  insertCtrl.run('ctrl_ret_audit', 'org_banglapay', 'CTRL-AUD-02', 'Quarterly Retention Integrity Attestation Control', 'Automated quarterly verification job validating zero premature purges and checksum parity.', 'Compliance', 'Requires Update', 'Pending Verification', null);
  insertCtrl.run('ctrl_aml_str', 'org_banglapay', 'CTRL-AML-03', 'Real-Time 4-Hour Structuring Window Rule', 'Flink streaming window rule flagging split deposits across 4-hour sliding intervals.', 'Risk Engineering', 'Action Required', 'Pending Verification', null);
  insertCtrl.run('ctrl_sec_mfa', 'org_banglapay', 'CTRL-SEC-07', 'Production DB Hardware MFA Enforcement', 'FIDO2 hardware token enforcement for all Transaction DB privileged roles.', 'Platform Security', 'Implemented', 'Verified', '2026-11-12T16:20:00.000Z');
  insertCtrl.run('ctrl_log_imm', 'org_banglapay', 'CTRL-LOG-01', 'Immutable Audit Trail Integrity', 'Append-only cryptographic hash chain for compliance & administrative events.', 'Platform Security', 'Implemented', 'Verified', '2026-11-10T12:00:00.000Z');

  // 10. Policies with AI-recommended Diffs awaiting Human Approval
  const insertPol = db.prepare(
    `INSERT INTO policies (id, organization_id, regulation_id, title, version, current_text, proposed_text, status, approved_by, approved_at, review_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertPol.run(
    'pol_data_retention',
    'org_banglapay',
    'reg_bb_retention',
    'Data Retention & Archival Policy',
    'v2.1 → v2.2 (Proposed)',
    `Section 4.1 Customer KYC Records:\nAll customer onboarding files, NID verifications, and account agreements shall be retained for a minimum period of 3 years following account closure.\n\nSection 4.2 Transaction Ledgers:\nCore settlement and P2P ledger records shall be archived in Transaction DB hot storage for 18 months and cold archival for 3 years total.`,
    `Section 4.1 Customer KYC Records:\nAll customer onboarding files, NID verifications, and biometric verification logs shall be retained for a minimum period of 5 years following account closure in tamper-evident immutable storage.\n\nSection 4.2 Transaction Ledgers:\nCore settlement and P2P ledger records shall be archived in Transaction DB hot storage for 18 months and immutable WORM archival for a minimum period of 5 years total, subject to quarterly retention audit attestations.`,
    'Pending Approval',
    null,
    null,
    null
  );

  insertPol.run(
    'pol_kyc_sop',
    'org_banglapay',
    'reg_bb_retention',
    'KYC Lifecycle & Biometric Verification SOP',
    'v1.4 → v1.5 (Proposed)',
    `Biometric and NID verification logs are stored in KYC Document Vault with a 3-year lifecycle expiry rule in AWS S3.`,
    `Biometric and NID verification logs are stored in KYC Document Vault with S3 Object Lock (COMPLIANCE mode) enforcing a minimum 5-year (1,825-day) non-deletable retention period.`,
    'Pending Approval',
    null,
    null,
    null
  );

  // 11. Knowledge Graph Edges for Circular PSD-09/2026
  const insertEdge = db.prepare(
    `INSERT INTO graph_edges (id, organization_id, regulation_id, source_type, source_id, source_label, target_type, target_id, target_label, relationship)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertEdge.run('ge_1', 'org_banglapay', 'reg_bb_retention', 'Regulation', 'reg_bb_retention', 'BB Circular PSD-09/2026', 'Obligation', 'obl_ret_1', 'OBL-RET-01: 5-Yr KYC Retention', 'CREATES');
  insertEdge.run('ge_2', 'org_banglapay', 'reg_bb_retention', 'Regulation', 'reg_bb_retention', 'BB Circular PSD-09/2026', 'Obligation', 'obl_ret_2', 'OBL-RET-02: 5-Yr Ledger Archival', 'CREATES');
  insertEdge.run('ge_3', 'org_banglapay', 'reg_bb_retention', 'Regulation', 'reg_bb_retention', 'BB Circular PSD-09/2026', 'Obligation', 'obl_ret_3', 'OBL-RET-03: Quarterly Retention Audit', 'CREATES');
  insertEdge.run('ge_4', 'org_banglapay', 'reg_bb_retention', 'Obligation', 'obl_ret_1', 'OBL-RET-01: 5-Yr KYC Retention', 'Control', 'ctrl_ret_kyc', 'CTRL-KYC-04: Immutable KYC Vault', 'SATISFIED_BY');
  insertEdge.run('ge_5', 'org_banglapay', 'reg_bb_retention', 'Obligation', 'obl_ret_2', 'OBL-RET-02: 5-Yr Ledger Archival', 'Control', 'ctrl_ret_ledger', 'CTRL-RET-01: 5-Yr Ledger Archival', 'SATISFIED_BY');
  insertEdge.run('ge_6', 'org_banglapay', 'reg_bb_retention', 'Obligation', 'obl_ret_3', 'OBL-RET-03: Quarterly Retention Audit', 'Control', 'ctrl_ret_audit', 'CTRL-AUD-02: Quarterly Audit Control', 'SATISFIED_BY');
  insertEdge.run('ge_7', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_ledger', 'CTRL-RET-01: 5-Yr Ledger Archival', 'Policy', 'pol_data_retention', 'Policy: Data Retention & Archival', 'DOCUMENTED_BY');
  insertEdge.run('ge_8', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_kyc', 'CTRL-KYC-04: Immutable KYC Vault', 'Policy', 'pol_kyc_sop', 'SOP: KYC Lifecycle & Biometrics', 'DOCUMENTED_BY');
  insertEdge.run('ge_9', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_ledger', 'CTRL-RET-01: 5-Yr Ledger Archival', 'System', 'sys_txdb', 'System: Transaction DB', 'IMPLEMENTED_BY');
  insertEdge.run('ge_10', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_kyc', 'CTRL-KYC-04: Immutable KYC Vault', 'System', 'sys_kycvault', 'System: KYC Document Vault', 'IMPLEMENTED_BY');
  insertEdge.run('ge_11', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_ledger', 'CTRL-RET-01: 5-Yr Ledger Archival', 'Remediation', 'rem_act_02', 'ACT-02: Configure 5-Yr Ledger WORM', 'REQUIRES');
  insertEdge.run('ge_12', 'org_banglapay', 'reg_bb_retention', 'Control', 'ctrl_ret_kyc', 'CTRL-KYC-04: Immutable KYC Vault', 'Remediation', 'rem_act_03', 'ACT-03: Enable S3 Object Lock on KYC Vault', 'REQUIRES');

  // 12. Remediation Actions (4 actions for BB-PSD-09/2026 + 2 for other regs)
  const insertRem = db.prepare(
    `INSERT INTO remediation_actions (
      id, organization_id, regulation_id, obligation_id, control_id, policy_id, code, title, description,
      required_change, owner_name, owner_department, priority, deadline, status, source_citation, confidence, required_evidence_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertRem.run(
    'rem_act_01',
    'org_banglapay',
    'reg_bb_retention',
    'obl_ret_1',
    'ctrl_ret_kyc',
    'pol_data_retention',
    'ACT-01',
    'Update Data Retention & Archival Policy to 5 Years',
    'Amend Section 4.1 and 4.2 of BanglaPay Data Retention Policy from 3 years to 5 years immutable retention.',
    'Increase retention duration from 3 to 5 years and add quarterly audit attestation mandate.',
    'Tariq Rahman',
    'Compliance',
    'HIGH',
    '2026-12-18',
    'Ready for Review',
    'Bangladesh Bank Circular PSD-09/2026 §4.2',
    'High',
    JSON.stringify(['Updated policy v2.2', 'Compliance Officer approval record']),
    now,
    now
  );

  insertRem.run(
    'rem_act_02',
    'org_banglapay',
    'reg_bb_retention',
    'obl_ret_2',
    'ctrl_ret_ledger',
    'pol_data_retention',
    'ACT-02',
    'Configure 5-Year Immutable Archival on Transaction DB',
    'Extend Transaction DB cold-archive lifecycle policy to 1,825 days with S3 Object Lock COMPLIANCE mode.',
    'Update archival Terraform/S3 lifecycle config from 1,095 days to 1,825 days immutable lock.',
    'Rafiq Ahmed',
    'Engineering',
    'HIGH',
    '2026-12-22',
    'In Progress',
    'Bangladesh Bank Circular PSD-09/2026 §4.2(b)',
    'High',
    JSON.stringify(['S3 Object Lock Terraform/JSON config', 'Retention verification log']),
    now,
    now
  );

  insertRem.run(
    'rem_act_03',
    'org_banglapay',
    'reg_bb_retention',
    'obl_ret_1',
    'ctrl_ret_kyc',
    'pol_kyc_sop',
    'ACT-03',
    'Migrate KYC Document Vault to 5-Year Biometric Retention',
    'Update KYC Vault S3 bucket lifecycle and biometric verification log archival job.',
    'Extend KYC & biometric log expiry rule from 3 years to 5 years non-deletable.',
    'Rafiq Ahmed',
    'Engineering',
    'HIGH',
    '2026-12-24',
    'Not Started',
    'Bangladesh Bank Circular PSD-09/2026 §4.2(a)',
    'High',
    JSON.stringify(['KYC Vault lifecycle configuration export', 'Biometric log archival sample']),
    now,
    now
  );

  insertRem.run(
    'rem_act_04',
    'org_banglapay',
    'reg_bb_retention',
    'obl_ret_3',
    'ctrl_ret_audit',
    null,
    'ACT-04',
    'Schedule Quarterly Retention Integrity Audit Attestation',
    'Configure automated checksum verification report and quarterly Compliance sign-off cadence.',
    'Implement quarterly retention integrity report and compliance attestation workflow.',
    'Tariq Rahman',
    'Compliance',
    'MEDIUM',
    '2026-12-30',
    'Not Started',
    'Bangladesh Bank Circular PSD-09/2026 §4.2(c)',
    'High',
    JSON.stringify(['Quarterly audit schedule config', 'Baseline integrity checksum report']),
    now,
    now
  );

  insertRem.run(
    'rem_act_05',
    'org_banglapay',
    'reg_bfiu_str',
    'obl_str_1',
    'ctrl_aml_str',
    null,
    'ACT-05',
    'Update STR Screening Pipeline to 4-Hour Sliding Window',
    'Reconfigure Flink CEP structuring detector from 24h calendar window to 4h rolling window and enable 12h goAML export.',
    'Deploy updated Flink window rule and verify alert latency.',
    'Rafiq Ahmed',
    'Engineering',
    'CRITICAL',
    '2026-12-10',
    'In Progress',
    'BFIU Master Circular 34/2026 §7',
    'High',
    JSON.stringify(['Flink CEP window rule diff', 'Staging goAML XML test export']),
    now,
    now
  );

  insertRem.run(
    'rem_act_06',
    'org_banglapay',
    'reg_bb_ict',
    'obl_ict_1',
    'ctrl_sec_mfa',
    null,
    'ACT-06',
    'Enforce FIDO2 Hardware MFA & 90-Day API Key Rotation',
    'Roll out FIDO2 keys to DBAs and activate Vault 90-day dynamic lease rotation.',
    'Complete hardware key enrollment and Vault TTL update.',
    'Rafiq Ahmed',
    'Engineering',
    'HIGH',
    '2027-01-05',
    'Verified',
    'Bangladesh Bank ICT Guideline v4.2 §11',
    'High',
    JSON.stringify(['IAM FIDO2 policy export', 'Vault 90-day lease configuration']),
    '2026-11-11T09:00:00.000Z',
    '2026-11-12T16:20:00.000Z'
  );

  // 13. Seeded Evidence Items
  const insertEv = db.prepare(
    `INSERT INTO evidence_items (
      id, organization_id, remediation_id, control_id, obligation_id, title, evidence_type, filename, mime_type, size_bytes,
      storage_path, extracted_text, status, ai_assessment_json, reviewer_name, review_notes, verified_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertEv.run(
    'ev_mfa_iam',
    'org_banglapay',
    'rem_act_06',
    'ctrl_sec_mfa',
    'obl_ict_1',
    'AWS IAM FIDO2 Hardware MFA & Vault 90-Day Rotation Policy',
    'configuration',
    'iam_fido2_mfa_vault_ttl.json',
    'application/json',
    4820,
    '{"mfaRequired":"FIDO2_HARDWARE","dbAdminRoles":["rds-prod-admin"],"vaultApiKeyTtlDays":90,"rotationMode":"automated"}',
    'Accepted',
    JSON.stringify({
      recommendation: 'PASS_RECOMMENDED',
      confidence: 'High',
      summary: 'Configuration enforces phishing-resistant FIDO2 MFA on production DB roles and 90-day Vault API credential rotation.',
      matchedCriteria: ['FIDO2 hardware MFA enabled', '90-day automated rotation TTL'],
      gapsOrNotes: [],
      disclaimer: 'Compliance decision support only — verified by Compliance Officer.',
    }),
    'Tariq Rahman',
    'Verified against BB-ICT-4.2 §11 requirements.',
    '2026-11-12T16:20:00.000Z',
    '2026-11-12T15:10:00.000Z'
  );

  insertEv.run(
    'ev_ret_draft',
    'org_banglapay',
    'rem_act_02',
    'ctrl_ret_ledger',
    'obl_ret_2',
    'Transaction DB S3 Object Lock Lifecycle Configuration (1825 Days)',
    'configuration',
    'txdb_archive_object_lock.json',
    'application/json',
    3140,
    '{"bucket":"banglapay-tx-ledger-archive","objectLockEnabled":true,"mode":"COMPLIANCE","retainDays":1825,"checksumAlgorithm":"SHA256","immutable":true}',
    'Under Review',
    JSON.stringify({
      recommendation: 'PASS_RECOMMENDED',
      confidence: 'High',
      summary: 'S3 Object Lock COMPLIANCE mode configured for 1,825 days (5 years) with SHA-256 integrity checks, matching Circular PSD-09/2026 §4.2(b).',
      matchedCriteria: ['Minimum 5-year (1,825-day) retention period', 'Tamper-evident COMPLIANCE Object Lock mode'],
      gapsOrNotes: ['Requires Compliance Officer final verification sign-off'],
      disclaimer: 'Compliance decision support only; final approval requires human reviewer confirmation.',
    }),
    null,
    null,
    null,
    '2026-11-21T11:15:00.000Z'
  );

  // 14. Audit Trail Events
  const insertAud = db.prepare(
    `INSERT INTO audit_events (
      id, organization_id, timestamp, actor_name, actor_role, action, object_type, object_id, object_label, previous_state, new_state, source_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  insertAud.run('aud_01', 'org_banglapay', '2026-11-21T10:42:00.000Z', 'Regulatory Monitor', 'System', 'Regulation detected', 'Regulation', 'reg_bb_retention', 'BB-PSD-09/2026', 'Version 1 (3-yr retention)', 'Version 2 (5-yr retention)', 'Bangladesh Bank Circular PSD-09/2026');
  insertAud.run('aud_02', 'org_banglapay', '2026-11-21T10:44:00.000Z', 'ComplianceOS Engine', 'System', 'Applicability analysis completed', 'Regulation', 'reg_bb_retention', 'BB-PSD-09/2026', 'Pending Analysis', 'Applicable (High Confidence)', 'Company Profile + Policy v2.1');
  insertAud.run('aud_03', 'org_banglapay', '2026-11-21T10:45:00.000Z', 'ComplianceOS Engine', 'System', '3 affected controls identified', 'Control Set', 'reg_bb_retention', 'CTRL-RET-01, CTRL-KYC-04, CTRL-AUD-02', 'Nominal', 'Requires Update', 'Knowledge Graph Impact Traversal');
  insertAud.run('aud_04', 'org_banglapay', '2026-11-21T10:47:00.000Z', 'ComplianceOS Engine', 'System', 'Action plan generated', 'Action Plan', 'reg_bb_retention', 'ACT-01 through ACT-04', 'None', '4 Remediation Actions Created', 'PSD-09/2026 §4.2');
  insertAud.run('aud_05', 'org_banglapay', '2026-11-21T11:15:00.000Z', 'Rafiq Ahmed', 'engineering', 'Evidence uploaded', 'Evidence', 'ev_ret_draft', 'txdb_archive_object_lock.json', 'Missing', 'Under Review', 'ACT-02 / CTRL-RET-01');
  insertAud.run('aud_06', 'org_banglapay', '2026-11-12T16:20:00.000Z', 'Tariq Rahman', 'compliance_officer', 'Verification completed', 'Control', 'ctrl_sec_mfa', 'CTRL-SEC-07 Hardware MFA', 'Implemented', 'Verified', 'BB-ICT-4.2 §11');

  // 15. Notifications
  const insertNotif = db.prepare(
    `INSERT INTO notifications (id, organization_id, title, message, category, link_view, link_id, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  );
  insertNotif.run('not_1', 'org_banglapay', 'High-Impact Circular: BB-PSD-09/2026', 'Customer & transaction retention increased from 3 to 5 years. 4 remediation actions generated.', 'regulation', 'regulations', 'reg_bb_retention', '2026-11-21T10:47:00.000Z');
  insertNotif.run('not_2', 'org_banglapay', 'Critical BFIU Update: Master Circular 34/2026', 'Rolling 4-hour structuring detection deadline is 2026-12-15.', 'critical', 'regulations', 'reg_bfiu_str', '2026-11-21T10:50:00.000Z');
  insertNotif.run('not_3', 'org_banglapay', 'Policy Approval Requested', 'Data Retention & Archival Policy v2.2 diff is awaiting Compliance Officer approval.', 'approval', 'remediation', 'rem_act_01', '2026-11-21T11:00:00.000Z');
  insertNotif.run('not_4', 'org_banglapay', 'Evidence Ready for Verification', 'Rafiq Ahmed uploaded txdb_archive_object_lock.json for ACT-02.', 'evidence', 'evidence', 'ev_ret_draft', '2026-11-21T11:16:00.000Z');

  seedCompanyProfilesAndApplicability();
}

export function seedStarterWorkspaceForNewOrg(params: {
  organizationId: string;
  companyName: string;
  country: string;
  industry: string;
  actorName: string;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO company_profiles (organization_id, business_json, data_json, infrastructure_json, compliance_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.organizationId,
    JSON.stringify({
      products: [`${params.companyName} Core Platform`],
      services: [params.industry],
      businessActivities: ['Digital Operations'],
      customerTypes: ['Business & Retail Customers'],
    }),
    JSON.stringify({
      categories: ['Personal Data', 'Financial Data'],
      crossBorderTransfer: false,
      monthlyTransactions: 'Initial Setup',
    }),
    JSON.stringify({
      cloudProviders: ['Primary Cloud Infrastructure'],
      databases: ['Primary Production DB'],
      criticalSystems: ['Core Application API'],
      securitySystems: ['IAM & Audit Logging'],
    }),
    JSON.stringify({
      regulators: [params.country === 'Bangladesh' ? 'Bangladesh Bank' : 'National Financial Regulator'],
      certifications: [],
      frameworks: ['Internal Control Baseline'],
    }),
    now
  );

  // Seed 2 monitored demonstration regulations scoped specifically to this new org
  const reg1Id = `reg_${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO regulations (
      id, organization_id, code, title, regulator, jurisdiction, source_url, publication_date, effective_date,
      severity, applicability_status, applicability_confidence, status, current_version, summary, content_hash, retrieved_at, is_demo_seeded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, 1)`
  ).run(
    reg1Id,
    params.organizationId,
    'BB-PSD-09/2026',
    'Circular PSD-09/2026: Customer & Transaction Record Retention Directive',
    'Bangladesh Bank',
    'Bangladesh',
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture',
    '2026-11-18',
    '2026-12-31',
    'High',
    'Pending Review',
    'Medium',
    'Action Required',
    'Mandates increasing minimum retention of customer KYC dossiers and transaction ledgers from 3 years to 5 years in tamper-evident storage.',
    sha256(`${reg1Id}-v2`),
    now
  );

  db.prepare(
    `INSERT INTO regulation_versions (
      id, regulation_id, organization_id, version_number, published_at, effective_date, raw_text,
      diff_previous_text, diff_new_text, diff_highlights_json, content_hash, source_url
    ) VALUES (?, ?, ?, 2, '2026-11-18', '2026-12-31', ?, ?, ?, ?, ?, ?)`
  ).run(
    `ver_${crypto.randomUUID().slice(0, 8)}`,
    reg1Id,
    params.organizationId,
    'Circular PSD-09/2026 Clause 4.2: Regulated entities must retain customer KYC and transaction records for 5 years in tamper-evident immutable storage.',
    'Regulated entities shall retain customer KYC records and transaction ledgers for 3 years.',
    'Regulated entities shall retain all customer KYC dossiers, biometric logs, and transaction ledgers for 5 years in tamper-evident immutable storage.',
    JSON.stringify([{ type: 'modified', previous: '3 years', current: '5 years' }]),
    sha256(`${reg1Id}-v2`),
    'https://www.bb.org.bd/mediaroom/circulars/psd/psd092026-demo-fixture'
  );

  db.prepare(
    `INSERT INTO audit_events (
      id, organization_id, timestamp, actor_name, actor_role, action, object_type, object_id, object_label, previous_state, new_state, source_ref
    ) VALUES (?, ?, ?, ?, 'org_admin', 'Organization workspace created', 'Organization', ?, ?, 'None', 'Active Workspace', 'Self-Service Signup')`
  ).run(`aud_${crypto.randomUUID().slice(0, 8)}`, params.organizationId, now, params.actorName, params.organizationId, params.companyName);
}
