import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const DB_PATH = path.join(DATA_DIR, 'complianceos.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export const db = new DatabaseSync(DB_PATH);

export function getUploadBaseDir(): string {
  return UPLOAD_DIR;
}

export function initDatabase(): void {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT NOT NULL,
      industry TEXT NOT NULL,
      size TEXT NOT NULL,
      operating_jurisdictions TEXT NOT NULL,
      business_description TEXT NOT NULL,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      department TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS platform_admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT,
      organization_id TEXT,
      is_platform_admin INTEGER NOT NULL DEFAULT 0,
      admin_username TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS company_profiles (
      organization_id TEXT PRIMARY KEY,
      business_json TEXT NOT NULL,
      data_json TEXT NOT NULL,
      infrastructure_json TEXT NOT NULL,
      compliance_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      classification TEXT NOT NULL,
      status TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      storage_path TEXT,
      extracted_text TEXT NOT NULL,
      summary TEXT NOT NULL,
      chunk_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      regulator TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      source_url TEXT NOT NULL,
      publication_date TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      severity TEXT NOT NULL,
      applicability_status TEXT NOT NULL,
      applicability_confidence TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL DEFAULT 1,
      summary TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      is_demo_seeded INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulation_versions (
      id TEXT PRIMARY KEY,
      regulation_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      published_at TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      diff_previous_text TEXT NOT NULL,
      diff_new_text TEXT NOT NULL,
      diff_highlights_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_url TEXT NOT NULL,
      FOREIGN KEY (regulation_id) REFERENCES regulations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS applicability_assessments (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      regulation_id TEXT NOT NULL,
      verdict TEXT NOT NULL,
      confidence TEXT NOT NULL,
      summary TEXT NOT NULL,
      profile_reasons_json TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      is_ai_generated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (regulation_id) REFERENCES regulations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      regulation_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requirement_ref TEXT NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (regulation_id) REFERENCES regulations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS controls (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      owner_department TEXT NOT NULL,
      status TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      last_verified_at TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS policies (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      regulation_id TEXT,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      current_text TEXT NOT NULL,
      proposed_text TEXT NOT NULL,
      status TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      review_note TEXT,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS systems (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      provider TEXT NOT NULL,
      data_classification TEXT NOT NULL,
      owner_department TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_edges (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      regulation_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_label TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      target_label TEXT NOT NULL,
      relationship TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS remediation_actions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      regulation_id TEXT NOT NULL,
      obligation_id TEXT,
      control_id TEXT,
      policy_id TEXT,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      required_change TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_department TEXT NOT NULL,
      priority TEXT NOT NULL,
      deadline TEXT NOT NULL,
      status TEXT NOT NULL,
      source_citation TEXT NOT NULL,
      confidence TEXT NOT NULL,
      required_evidence_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS remediation_comments (
      id TEXT PRIMARY KEY,
      remediation_id TEXT NOT NULL,
      organization_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (remediation_id) REFERENCES remediation_actions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      remediation_id TEXT NOT NULL,
      control_id TEXT,
      obligation_id TEXT,
      title TEXT NOT NULL,
      evidence_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT,
      extracted_text TEXT NOT NULL,
      status TEXT NOT NULL,
      ai_assessment_json TEXT,
      reviewer_name TEXT,
      review_notes TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      action TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      object_label TEXT NOT NULL,
      previous_state TEXT NOT NULL,
      new_state TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT NOT NULL,
      link_view TEXT NOT NULL,
      link_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    -- Global / Public Regulatory Intelligence & Change Detection Tables
    CREATE TABLE IF NOT EXISTS regulatory_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      state_province TEXT,
      regulator TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_url TEXT NOT NULL,
      description TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      monitoring_frequency TEXT NOT NULL DEFAULT 'daily',
      last_checked_at TEXT,
      last_successful_fetch_at TEXT,
      last_content_hash TEXT,
      last_error TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS regulatory_documents (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      country TEXT NOT NULL,
      state_province TEXT,
      regulator TEXT NOT NULL,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL,
      regulatory_identifier TEXT NOT NULL,
      industry_tags_json TEXT NOT NULL,
      company_types_json TEXT NOT NULL,
      business_activities_json TEXT NOT NULL,
      regulated_products_json TEXT NOT NULL,
      thresholds_json TEXT NOT NULL,
      topics_json TEXT NOT NULL,
      current_version_id TEXT,
      current_version_number INTEGER NOT NULL DEFAULT 1,
      latest_change_status TEXT NOT NULL DEFAULT 'NEW',
      publication_date TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      source_url TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES regulatory_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulatory_document_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      regulator TEXT NOT NULL,
      title TEXT NOT NULL,
      document_type TEXT NOT NULL,
      regulatory_identifier TEXT NOT NULL,
      publication_date TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      source_url TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      previous_version_id TEXT,
      next_version_id TEXT,
      change_status TEXT NOT NULL,
      raw_document_location TEXT,
      extracted_text TEXT NOT NULL,
      sections_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES regulatory_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES regulatory_sources(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulatory_changes (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      previous_version_id TEXT,
      new_version_id TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      regulator TEXT NOT NULL,
      regulatory_identifier TEXT NOT NULL,
      regulation_title TEXT NOT NULL,
      change_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      is_material INTEGER NOT NULL DEFAULT 1,
      change_date TEXT NOT NULL,
      diff_summary_text TEXT NOT NULL,
      structured_diff_json TEXT NOT NULL,
      ai_summary_json TEXT,
      affected_obligation_count INTEGER NOT NULL DEFAULT 0,
      source_url TEXT NOT NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES regulatory_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (source_id) REFERENCES regulatory_sources(id) ON DELETE CASCADE,
      FOREIGN KEY (new_version_id) REFERENCES regulatory_document_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulatory_requirements (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      section_ref TEXT NOT NULL,
      title TEXT NOT NULL,
      requirement_text TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES regulatory_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (version_id) REFERENCES regulatory_document_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulatory_obligations (
      id TEXT PRIMARY KEY,
      regulation_id TEXT NOT NULL,
      regulation_version_id TEXT NOT NULL,
      requirement_id TEXT,
      change_id TEXT,
      jurisdiction TEXT NOT NULL,
      regulator TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      obligation_type TEXT NOT NULL,
      applicability_conditions_json TEXT NOT NULL,
      required_action TEXT NOT NULL,
      deadline TEXT,
      frequency TEXT,
      responsible_entity TEXT NOT NULL,
      evidence_required_json TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      confidence TEXT NOT NULL,
      change_status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (regulation_id) REFERENCES regulatory_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (regulation_version_id) REFERENCES regulatory_document_versions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS regulatory_ingestion_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT,
      status TEXT NOT NULL,
      documents_fetched INTEGER NOT NULL DEFAULT 0,
      versions_created INTEGER NOT NULL DEFAULT 0,
      changes_detected INTEGER NOT NULL DEFAULT 0,
      obligations_extracted INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      events_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS organization_change_reviews (
      organization_id TEXT NOT NULL,
      change_id TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'UNREVIEWED',
      reviewed_by TEXT,
      notes TEXT,
      reviewed_at TEXT,
      PRIMARY KEY (organization_id, change_id),
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (change_id) REFERENCES regulatory_changes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS company_profile_versions (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      profile_json TEXT NOT NULL,
      completeness_pct INTEGER NOT NULL DEFAULT 0,
      changed_by TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS obligation_applicability_assessments (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      obligation_id TEXT NOT NULL,
      regulation_id TEXT NOT NULL,
      regulation_version_id TEXT NOT NULL,
      change_id TEXT,
      decision TEXT NOT NULL,
      confidence_level TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 0.5,
      evaluation_method TEXT NOT NULL,
      deterministic_decision TEXT NOT NULL,
      reasoning_summary TEXT NOT NULL,
      matched_conditions_json TEXT NOT NULL,
      failed_conditions_json TEXT NOT NULL,
      conflicting_conditions_json TEXT NOT NULL,
      missing_information_json TEXT NOT NULL,
      source_references_json TEXT NOT NULL,
      relevant_excerpts_json TEXT NOT NULL,
      evaluated_profile_version INTEGER NOT NULL,
      model_provider TEXT,
      model_name TEXT,
      requires_human_review INTEGER NOT NULL DEFAULT 0,
      human_review_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
      human_override_decision TEXT,
      reviewer_name TEXT,
      review_comment TEXT,
      reviewed_at TEXT,
      is_stale INTEGER NOT NULL DEFAULT 0,
      evaluated_at TEXT NOT NULL,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      FOREIGN KEY (obligation_id) REFERENCES regulatory_obligations(id) ON DELETE CASCADE,
      FOREIGN KEY (regulation_id) REFERENCES regulatory_documents(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_reg_docs_identifier ON regulatory_documents(regulatory_identifier);
    CREATE INDEX IF NOT EXISTS idx_reg_docs_jurisdiction ON regulatory_documents(jurisdiction);
    CREATE INDEX IF NOT EXISTS idx_reg_versions_doc ON regulatory_document_versions(document_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_reg_changes_doc ON regulatory_changes(document_id, change_date);
    CREATE INDEX IF NOT EXISTS idx_reg_obligations_reg ON regulatory_obligations(regulation_id, regulation_version_id);
    CREATE INDEX IF NOT EXISTS idx_profile_versions_org ON company_profile_versions(organization_id, version_number);
    CREATE INDEX IF NOT EXISTS idx_obl_app_org_obl ON obligation_applicability_assessments(organization_id, obligation_id, evaluated_at);
  `);

  const profileCols = db.prepare(`PRAGMA table_info(company_profiles)`).all() as Array<{ name: string }>;
  const profileColSet = new Set(profileCols.map((c) => c.name));
  if (!profileColSet.has('current_version_number')) {
    db.exec(`ALTER TABLE company_profiles ADD COLUMN current_version_number INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!profileColSet.has('structured_profile_json')) {
    db.exec(`ALTER TABLE company_profiles ADD COLUMN structured_profile_json TEXT;`);
  }
}
