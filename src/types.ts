export type NavView =
  | 'dashboard'
  | 'compliance-center'
  | 'regulations'
  | 'applicability'
  | 'company-profile'
  | 'documents'
  | 'controls'
  | 'remediation'
  | 'evidence'
  | 'knowledge-graph'
  | 'audit-log'
  | 'users'
  | 'settings';

export type ProfileTriState = 'UNKNOWN' | 'NOT_APPLICABLE' | 'NOT_PROVIDED';

export interface StructuredCompanyProfile {
  identity: {
    legal_name: string;
    trading_name: string;
    registration_number: string;
    country: string;
    headquarters_location: string;
  };
  business: {
    industry: string;
    business_activities: string[];
    products_services: string[];
    business_model: string;
    company_type: string;
  };
  scale: {
    employee_count: number | ProfileTriState;
    annual_revenue: number | ProfileTriState;
    annual_revenue_currency: string;
    assets: number | ProfileTriState;
    operating_regions: string[];
  };
  regulatory: {
    regulated_industries: string[];
    licenses: string[];
    regulatory_status: string;
    regulated_products: string[];
    data_processing_activities: string[];
  };
  geography: {
    countries_of_operation: string[];
    states_provinces_regions: string[];
    customer_locations: string[];
    data_storage_locations: string[];
  };
  technology: {
    cloud_providers: string[];
    critical_systems: string[];
    data_types_processed: string[];
    payment_processing: boolean | ProfileTriState;
    third_party_processors: string[];
  };
  risk_context: {
    risk_profile: string;
    sensitive_data_handled: boolean | ProfileTriState;
    critical_infrastructure: boolean | ProfileTriState;
    public_company_status: boolean | ProfileTriState;
    financial_institution_status: boolean | ProfileTriState;
  };
}

export interface ProfileCompleteness {
  pct: number;
  populatedCount: number;
  totalCount: number;
  missingRecommendedFields: Array<{ key: string; label: string; section: string }>;
  sectionScores: Record<string, { populated: number; total: number; pct: number }>;
}

export interface CompanyProfileVersion {
  id: string;
  organization_id: string;
  version_number: number;
  completeness_pct: number;
  changed_by: string;
  change_summary: string;
  created_at: string;
  profile: StructuredCompanyProfile;
}

export type ApplicabilityDecision =
  | 'APPLIES'
  | 'DOES_NOT_APPLY'
  | 'POTENTIALLY_APPLIES'
  | 'INSUFFICIENT_INFORMATION'
  | 'REQUIRES_REVIEW';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export interface ApplicabilityCondition {
  id: string;
  condition_type: string;
  operator: string;
  field_path: string;
  expected_value: unknown;
  is_exclusion?: boolean;
  hard_requirement?: boolean;
  description: string;
  source_reference?: string;
}

export interface EvaluatedConditionDetail {
  condition_id: string;
  condition_type: string;
  field_path: string;
  operator: string;
  expected_value: unknown;
  actual_value: unknown;
  status: 'MATCHED' | 'FAILED' | 'MISSING' | 'EXCLUDED';
  explanation: string;
  source_reference?: string;
}

export interface BoundedSourceExcerpt {
  source_type: 'REGULATION_SECTION' | 'INTERNAL_DOCUMENT';
  title: string;
  section: string;
  version: string;
  excerpt: string;
}

export interface ObligationApplicabilityAssessment {
  id: string;
  organization_id: string;
  obligation_id: string;
  regulation_id: string;
  regulation_version_id: string;
  change_id: string | null;
  decision: ApplicabilityDecision;
  effective_decision: ApplicabilityDecision;
  confidence_level: ConfidenceLevel;
  confidence_score: number;
  evaluation_method: string;
  deterministic_decision: ApplicabilityDecision;
  reasoning_summary: string;
  matched_conditions: EvaluatedConditionDetail[];
  failed_conditions: EvaluatedConditionDetail[];
  conflicting_conditions: string[];
  missing_information: string[];
  source_references: Array<{ source: string; section: string; excerpt: string }>;
  relevant_excerpts: BoundedSourceExcerpt[];
  evaluated_profile_version: number;
  model_provider: string | null;
  model_name: string | null;
  requires_human_review: boolean;
  human_review_status: string;
  human_override_decision: ApplicabilityDecision | null;
  reviewer_name: string | null;
  review_comment: string | null;
  reviewed_at: string | null;
  is_stale: boolean;
  evaluated_at: string;
}

export interface ApplicabilityQueueItem {
  obligation: RegulatoryObligationItem & {
    structuredConditions: ApplicabilityCondition[];
    document_type?: string;
    publication_date?: string;
  };
  assessment: ObligationApplicabilityAssessment | null;
  effective_decision: ApplicabilityDecision;
  is_stale: boolean;
}

export interface ApplicabilitySummaryPayload {
  total: number;
  applicable: number;
  potentiallyApplicable: number;
  requiresReview: number;
  insufficientInformation: number;
  notApplicable: number;
  newApplicableObligations: number;
  staleAssessments: number;
  profileVersion: number;
  profileCompletenessPct: number;
}

export interface ApplicabilityDetailResponse {
  obligation: RegulatoryObligationItem & {
    structuredConditions: ApplicabilityCondition[];
    document_type?: string;
    publication_date?: string;
  };
  regulation: {
    id: string;
    regulatory_identifier: string;
    title: string;
    document_type: string;
    regulator: string;
    jurisdiction: string;
    state_province: string | null;
    version_number: number;
    publication_date: string;
    effective_date: string;
    source_url: string;
  };
  companyContext: {
    organizationName: string;
    profileVersion: number;
    completenessPct: number;
    structuredProfile: StructuredCompanyProfile;
  } | null;
  boundedExcerpts: BoundedSourceExcerpt[];
  latestAssessment: ObligationApplicabilityAssessment | null;
  assessmentHistory: ObligationApplicabilityAssessment[];
  linkedRemediations?: Array<
    RemediationItem & {
      evidence_count?: number;
      verified_evidence_count?: number;
    }
  >;
}

export interface UserInfo {
  id: string;
  organizationId: string;
  fullName: string;
  email: string;
  role: 'org_admin' | 'compliance_officer' | 'engineering' | 'auditor' | string;
  department: string;
}

export interface Organization {
  id: string;
  name: string;
  country: string;
  industry: string;
  size: string;
  operating_jurisdictions: string;
  business_description: string;
  onboarding_completed: number;
  is_demo: number;
  created_at: string;
}

export interface StructuredDiffItem {
  change_type: 'ADDED' | 'REMOVED' | 'MODIFIED';
  section: string;
  category: string;
  old_value: string;
  new_value: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
  citation: string;
}

export interface SemanticChangeSummary {
  summary: string;
  meaning: string;
  is_obligation_change: boolean;
  affected_entities: string[];
  changed_deadlines: string[];
  changed_thresholds: string[];
  operational_changes: string[];
  material_changes: string[];
  affected_obligation_types: string[];
  potential_impact: string;
  recommended_review: string[];
  citations: Array<{ version: string; section: string; excerpt: string }>;
  confidence: 'High' | 'Medium' | 'Low' | string;
  insufficient_evidence: boolean;
  ai_generated: boolean;
  model_name?: string;
}

export interface RegulatoryChangeSummaryCard {
  id: string;
  document_id: string;
  regulatory_identifier: string;
  regulation_title: string;
  regulator: string;
  jurisdiction: string;
  change_type: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
  is_material: number;
  affected_obligation_count: number;
  diff_summary_text: string;
  change_date: string;
  source_url: string;
  org_review_status: string;
  aiSummary: SemanticChangeSummary | null;
}

export interface DashboardData {
  organization: Organization;
  posture: {
    overallStatus: string;
    complianceCoveragePct: number;
    highRiskFindings: number;
    openActionsCount: number;
    verifiedControlsCount: number;
    totalControlsCount: number;
    evidenceGapsCount: number;
    pendingPolicyApprovals: number;
  };
  regulatorySummary: {
    requiringAttention: number;
    critical: number;
    high: number;
    medium: number;
    dismissed: number;
  };
  regulatoryIntelligence?: {
    sourcesMonitored: number;
    regulationsTracked: number;
    changesDetected: number;
    materialChanges: number;
    newObligations: number;
    highSeverityChanges: number;
    unreviewedChanges: number;
    recentChanges: RegulatoryChangeSummaryCard[];
  };
  applicabilitySummary?: ApplicabilitySummaryPayload & {
    items: Array<{
      obligationId: string;
      obligationTitle: string;
      obligationType: string;
      regulationId: string;
      regulatoryIdentifier: string;
      regulationTitle: string;
      regulator: string;
      jurisdiction: string;
      decision: ApplicabilityDecision;
      confidenceLevel: ConfidenceLevel;
      reason: string;
      reviewStatus: string;
      requiresHumanReview: boolean;
      isStale: boolean;
    }>;
  };
  regulationLoad?: Array<{ label: string; open: number; verified: number }>;
  remediationBreakdown: {
    notStarted: number;
    inProgress: number;
    readyForReview: number;
    verified: number;
    overdue: number;
  };
  evidenceBreakdown: {
    missing: number;
    uploaded: number;
    underReview: number;
    accepted: number;
    rejected: number;
  };
  recentActivity: AuditEvent[];
}

export interface RegulatorySourceItem {
  id: string;
  name: string;
  jurisdiction: string;
  state_province: string | null;
  regulator: string;
  source_type: string;
  source_url: string;
  description: string;
  active: number;
  monitoring_frequency: string;
  last_checked_at: string | null;
  last_successful_fetch_at: string | null;
  last_content_hash: string | null;
  last_error: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface RegulatoryIngestionRun {
  id: string;
  source_id: string | null;
  source_name?: string;
  jurisdiction?: string;
  status: string;
  documents_fetched: number;
  versions_created: number;
  changes_detected: number;
  obligations_extracted: number;
  error_message: string | null;
  events: Array<{ stage: string; timestamp: string; detail: string }>;
  started_at: string;
  completed_at: string | null;
}

export interface RegulatoryDocumentItem {
  id: string;
  source_id: string;
  source_name: string;
  source_type: string;
  jurisdiction: string;
  country: string;
  state_province: string | null;
  regulator: string;
  title: string;
  document_type: string;
  regulatory_identifier: string;
  publication_date: string;
  effective_date: string;
  retrieved_at: string;
  source_url: string;
  content_hash: string;
  current_version_id: string | null;
  current_version_number: number;
  latest_change_status: string;
  is_demo: number;
  obligation_count: number;
  version_count: number;
  industryTags: string[];
  companyTypes: string[];
  topics: string[];
  thresholds: string[];
}

export interface RegulatoryDocumentVersion {
  id: string;
  document_id: string;
  version_number: number;
  previous_version_id: string | null;
  next_version_id: string | null;
  publication_date: string;
  effective_date: string;
  retrieved_at: string;
  source_url: string;
  content_hash: string;
  raw_document_location: string | null;
  extracted_text: string;
  sections: Array<{ section: string; heading: string; text: string; page?: number }>;
  change_status: string;
  is_immutable: number;
  created_at: string;
}

export interface RegulatoryChangeItem {
  id: string;
  document_id: string;
  source_id: string;
  source_name?: string;
  source_type?: string;
  previous_version_id: string | null;
  new_version_id: string;
  regulator: string;
  jurisdiction: string;
  regulatory_identifier: string;
  regulation_title: string;
  change_type: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
  is_material: number;
  affected_obligation_count: number;
  structuredDiff: StructuredDiffItem[];
  diff_summary_text: string;
  aiSummary: SemanticChangeSummary | null;
  change_date: string;
  source_url: string;
  org_review_status: string;
  org_reviewed_by?: string | null;
  org_reviewed_at?: string | null;
  is_demo: number;
  created_at: string;
}

export interface RegulatoryObligationItem {
  id: string;
  regulation_id: string;
  regulation_version_id: string;
  change_id: string | null;
  requirement_id: string | null;
  regulatory_identifier?: string;
  regulation_title?: string;
  effective_date?: string;
  source_url?: string;
  version_number?: number;
  regulator: string;
  jurisdiction: string;
  obligation_type: string;
  title: string;
  description: string;
  applicabilityConditions: Record<string, any>;
  required_action: string;
  deadline: string;
  frequency: string;
  responsible_entity: string;
  evidenceRequired: string[];
  source_reference: string;
  confidence: string;
  change_status?: string;
  extraction_method?: string;
  is_demo?: number;
  created_at: string;
}

export interface RegulatoryLineageGraph {
  documentId: string;
  regulator: string;
  regulationIdentifier: string;
  nodes: Array<{ id: string; type: 'Regulator' | 'Regulation' | 'Version' | 'Requirement' | 'Obligation'; label: string }>;
  edges: Array<{ from: string; to: string; relationship: string }>;
}

export interface RegulatoryChangeDetail {
  change: RegulatoryChangeItem;
  oldVersion: RegulatoryDocumentVersion | null;
  newVersion: RegulatoryDocumentVersion | null;
  versionHistory: Array<{
    id: string;
    version_number: number;
    publication_date: string;
    effective_date: string;
    retrieved_at: string;
    content_hash: string;
    change_status: string;
    previous_version_id: string | null;
    next_version_id: string | null;
  }>;
  obligations: RegulatoryObligationItem[];
  lineage: RegulatoryLineageGraph | null;
  organizationReview: {
    organization_id: string;
    change_id: string;
    review_status: string;
    reviewed_by: string | null;
    notes: string | null;
    reviewed_at: string | null;
  };
}

export interface RegulationItem {
  id: string;
  code: string;
  title: string;
  regulator: string;
  jurisdiction: string;
  source_url: string;
  publication_date: string;
  effective_date: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
  applicability_status: string;
  applicability_confidence: string;
  status: string;
  current_version: number;
  summary: string;
  content_hash: string;
  retrieved_at: string;
  is_demo_seeded: number;
}

export interface RegulationDetail {
  regulation: RegulationItem;
  versions: Array<{
    id: string;
    version_number: number;
    published_at: string;
    effective_date: string;
    raw_text: string;
    diff_previous_text: string;
    diff_new_text: string;
    diffHighlights: Array<{ type: string; previous: string; current: string }>;
    content_hash: string;
    source_url: string;
  }>;
  applicability: {
    id: string;
    verdict: string;
    confidence: string;
    summary: string;
    profileReasons: Array<{ fact: string; matched: boolean; explanation: string }>;
    citations: Array<{ source: string; clause: string; excerpt: string }>;
    is_ai_generated: number;
    created_at: string;
  } | null;
  obligations: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    requirement_ref: string;
    status: string;
  }>;
  impactedControls: ControlItem[];
  impactedPolicies: PolicyItem[];
  impactedSystems: Array<{
    id: string;
    name: string;
    category: string;
    provider: string;
    data_classification: string;
    owner_department: string;
  }>;
  actions: RemediationItem[];
  graphEdges: GraphEdge[];
}

export interface ControlItem {
  id: string;
  code: string;
  title: string;
  description: string;
  owner_department: string;
  status: string;
  verification_status: string;
  last_verified_at: string | null;
}

export interface PolicyItem {
  id: string;
  regulation_id: string | null;
  title: string;
  version: string;
  current_text: string;
  proposed_text: string;
  status: string;
  approved_by: string | null;
  approved_at: string | null;
  review_note: string | null;
}

export interface RemediationItem {
  id: string;
  regulation_id: string;
  regulation_code?: string;
  regulation_title?: string;
  regulator?: string;
  obligation_id: string | null;
  control_id: string | null;
  policy_id: string | null;
  code: string;
  title: string;
  description: string;
  required_change: string;
  owner_name: string;
  owner_department: string;
  priority: string;
  deadline: string;
  status: string;
  source_citation: string;
  confidence: string;
  requiredEvidence: string[];
  comments?: Array<{
    id: string;
    author_name: string;
    body: string;
    created_at: string;
  }>;
}

export interface EvidenceItem {
  id: string;
  remediation_id: string;
  remediation_code?: string;
  remediation_title?: string;
  control_id: string | null;
  control_code?: string;
  control_title?: string;
  title: string;
  evidence_type: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  extracted_text: string;
  status: string;
  aiAssessment: {
    recommendation: string;
    confidence: string;
    summary: string;
    matchedCriteria: string[];
    gapsOrNotes: string[];
    disclaimer: string;
  } | null;
  reviewer_name: string | null;
  review_notes: string | null;
  verified_at: string | null;
  created_at: string;
}

export interface GraphEdge {
  id: string;
  regulation_id: string;
  source_type: string;
  source_id: string;
  source_label: string;
  target_type: string;
  target_id: string;
  target_label: string;
  relationship: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  actor_name: string;
  actor_role: string;
  action: string;
  object_type: string;
  object_id: string;
  object_label: string;
  previous_state: string;
  new_state: string;
  source_ref: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  category: string;
  link_view: NavView;
  link_id: string | null;
  is_read: number;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  classification: string;
  status: string;
  version: string;
  source: string;
  owner_name: string;
  summary: string;
  extracted_text?: string;
  chunk_count: number;
  created_at: string;
}
