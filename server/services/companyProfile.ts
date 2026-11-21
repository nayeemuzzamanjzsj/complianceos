import crypto from 'node:crypto';
import { db } from '../db.ts';
import { logAuditEvent } from './auth.ts';

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

const TRI_STATES = new Set<string>(['UNKNOWN', 'NOT_APPLICABLE', 'NOT_PROVIDED']);

export function isProfileMissingOrUnknown(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return true;
    return TRI_STATES.has(trimmed.toUpperCase());
  }
  if (Array.isArray(val)) return val.length === 0;
  return false;
}

export function isExplicitlyNotApplicable(val: unknown): boolean {
  return typeof val === 'string' && val.trim().toUpperCase() === 'NOT_APPLICABLE';
}

function cleanStringList(input: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(input)) {
    return Array.from(new Set(input.map((v) => String(v || '').trim()).filter(Boolean)));
  }
  if (typeof input === 'string') {
    return Array.from(
      new Set(
        input
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  }
  return fallback;
}

function normalizeNumberOrTriState(val: unknown, fallback: number | ProfileTriState = 'NOT_PROVIDED'): number | ProfileTriState {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0) return val;
  if (typeof val === 'string') {
    const upper = val.trim().toUpperCase();
    if (TRI_STATES.has(upper)) return upper as ProfileTriState;
    const numeric = Number(val.replace(/[,$\s]/g, ''));
    if (val.trim() && Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return fallback;
}

function normalizeBooleanOrTriState(val: unknown, fallback: boolean | ProfileTriState = 'UNKNOWN'): boolean | ProfileTriState {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') {
    const upper = val.trim().toUpperCase();
    if (TRI_STATES.has(upper)) return upper as ProfileTriState;
    if (upper === 'TRUE' || upper === 'YES' || upper === '1') return true;
    if (upper === 'FALSE' || upper === 'NO' || upper === '0') return false;
  }
  return fallback;
}

function normalizeStringOrTriState(val: unknown, fallback = 'NOT_PROVIDED'): string {
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return fallback;
    if (TRI_STATES.has(t.toUpperCase())) return t.toUpperCase();
    return t;
  }
  return fallback;
}

function parseEmployeeCountFromSize(sizeStr?: string): number | ProfileTriState {
  if (!sizeStr) return 'NOT_PROVIDED';
  const match = sizeStr.match(/(\d[\d,]*)/);
  if (!match) return 'NOT_PROVIDED';
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 'NOT_PROVIDED';
}

export function buildDefaultStructuredProfile(
  org: Record<string, any>,
  legacyProfile?: {
    business?: Record<string, any>;
    data?: Record<string, any>;
    infrastructure?: Record<string, any>;
    compliance?: Record<string, any>;
  } | null
): StructuredCompanyProfile {
  let jurisdictions: string[] = [];
  try {
    const parsed = JSON.parse(String(org.operating_jurisdictions || '[]'));
    if (Array.isArray(parsed)) jurisdictions = parsed.map(String).filter(Boolean);
  } catch {
    jurisdictions = org.country ? [String(org.country)] : [];
  }
  if (jurisdictions.length === 0 && org.country) {
    jurisdictions = [String(org.country)];
  }

  const business = legacyProfile?.business || {};
  const data = legacyProfile?.data || {};
  const infra = legacyProfile?.infrastructure || {};
  const compliance = legacyProfile?.compliance || {};

  const industryStr = String(org.industry || 'NOT_PROVIDED');
  const isFinancialLike = /fintech|financial|payment|bank|insur|wallet/i.test(
    `${industryStr} ${org.business_description || ''} ${(business.products || []).join(' ')}`
  );

  return {
    identity: {
      legal_name: String(org.name || 'NOT_PROVIDED'),
      trading_name: String(org.name || 'NOT_PROVIDED'),
      registration_number: 'NOT_PROVIDED',
      country: String(org.country || 'NOT_PROVIDED'),
      headquarters_location: org.country ? String(org.country) : 'NOT_PROVIDED',
    },
    business: {
      industry: industryStr,
      business_activities: cleanStringList(business.businessActivities, cleanStringList(business.services)),
      products_services: cleanStringList(business.products),
      business_model: org.business_description ? String(org.business_description).slice(0, 180) : 'NOT_PROVIDED',
      company_type: isFinancialLike ? 'Payment Service Provider' : 'NOT_PROVIDED',
    },
    scale: {
      employee_count: parseEmployeeCountFromSize(org.size),
      annual_revenue: 'UNKNOWN',
      annual_revenue_currency: 'BDT',
      assets: 'UNKNOWN',
      operating_regions: jurisdictions,
    },
    regulatory: {
      regulated_industries: isFinancialLike ? ['Financial Technology', 'Digital Payments'] : [],
      licenses: cleanStringList(compliance.frameworks).filter((f) => /license|psp|mfs|bank/i.test(f)),
      regulatory_status:
        Array.isArray(compliance.regulators) && compliance.regulators.length > 0
          ? `Regulated (${compliance.regulators.join(', ')})`
          : 'UNKNOWN',
      regulated_products: cleanStringList(business.products),
      data_processing_activities: cleanStringList(data.categories),
    },
    geography: {
      countries_of_operation: jurisdictions,
      states_provinces_regions: [],
      customer_locations: jurisdictions,
      data_storage_locations: cleanStringList(infra.cloudProviders),
    },
    technology: {
      cloud_providers: cleanStringList(infra.cloudProviders),
      critical_systems: cleanStringList(infra.criticalSystems, cleanStringList(infra.databases)),
      data_types_processed: cleanStringList(data.categories),
      payment_processing: isFinancialLike ? true : 'UNKNOWN',
      third_party_processors: cleanStringList(infra.securitySystems),
    },
    risk_context: {
      risk_profile: isFinancialLike ? 'High' : 'UNKNOWN',
      sensitive_data_handled:
        Array.isArray(data.categories) && data.categories.some((c: string) => /pii|kyc|nid|financial|personal|biometric/i.test(c))
          ? true
          : 'UNKNOWN',
      critical_infrastructure: isFinancialLike ? true : 'UNKNOWN',
      public_company_status: false,
      financial_institution_status: isFinancialLike ? true : 'UNKNOWN',
    },
  };
}

export function normalizeStructuredProfile(
  patch: Partial<StructuredCompanyProfile> | Record<string, any> | undefined,
  base: StructuredCompanyProfile
): StructuredCompanyProfile {
  if (!patch || typeof patch !== 'object') return base;
  const p = patch as Record<string, any>;

  return {
    identity: {
      legal_name: normalizeStringOrTriState(p.identity?.legal_name, base.identity.legal_name),
      trading_name: normalizeStringOrTriState(p.identity?.trading_name, base.identity.trading_name),
      registration_number: normalizeStringOrTriState(p.identity?.registration_number, base.identity.registration_number),
      country: normalizeStringOrTriState(p.identity?.country, base.identity.country),
      headquarters_location: normalizeStringOrTriState(p.identity?.headquarters_location, base.identity.headquarters_location),
    },
    business: {
      industry: normalizeStringOrTriState(p.business?.industry, base.business.industry),
      business_activities:
        p.business?.business_activities !== undefined
          ? cleanStringList(p.business.business_activities)
          : base.business.business_activities,
      products_services:
        p.business?.products_services !== undefined
          ? cleanStringList(p.business.products_services)
          : base.business.products_services,
      business_model: normalizeStringOrTriState(p.business?.business_model, base.business.business_model),
      company_type: normalizeStringOrTriState(p.business?.company_type, base.business.company_type),
    },
    scale: {
      employee_count:
        p.scale?.employee_count !== undefined
          ? normalizeNumberOrTriState(p.scale.employee_count, base.scale.employee_count)
          : base.scale.employee_count,
      annual_revenue:
        p.scale?.annual_revenue !== undefined
          ? normalizeNumberOrTriState(p.scale.annual_revenue, base.scale.annual_revenue)
          : base.scale.annual_revenue,
      annual_revenue_currency: normalizeStringOrTriState(
        p.scale?.annual_revenue_currency,
        base.scale.annual_revenue_currency || 'BDT'
      ),
      assets:
        p.scale?.assets !== undefined
          ? normalizeNumberOrTriState(p.scale.assets, base.scale.assets)
          : base.scale.assets,
      operating_regions:
        p.scale?.operating_regions !== undefined
          ? cleanStringList(p.scale.operating_regions)
          : base.scale.operating_regions,
    },
    regulatory: {
      regulated_industries:
        p.regulatory?.regulated_industries !== undefined
          ? cleanStringList(p.regulatory.regulated_industries)
          : base.regulatory.regulated_industries,
      licenses:
        p.regulatory?.licenses !== undefined ? cleanStringList(p.regulatory.licenses) : base.regulatory.licenses,
      regulatory_status: normalizeStringOrTriState(p.regulatory?.regulatory_status, base.regulatory.regulatory_status),
      regulated_products:
        p.regulatory?.regulated_products !== undefined
          ? cleanStringList(p.regulatory.regulated_products)
          : base.regulatory.regulated_products,
      data_processing_activities:
        p.regulatory?.data_processing_activities !== undefined
          ? cleanStringList(p.regulatory.data_processing_activities)
          : base.regulatory.data_processing_activities,
    },
    geography: {
      countries_of_operation:
        p.geography?.countries_of_operation !== undefined
          ? cleanStringList(p.geography.countries_of_operation)
          : base.geography.countries_of_operation,
      states_provinces_regions:
        p.geography?.states_provinces_regions !== undefined
          ? cleanStringList(p.geography.states_provinces_regions)
          : base.geography.states_provinces_regions,
      customer_locations:
        p.geography?.customer_locations !== undefined
          ? cleanStringList(p.geography.customer_locations)
          : base.geography.customer_locations,
      data_storage_locations:
        p.geography?.data_storage_locations !== undefined
          ? cleanStringList(p.geography.data_storage_locations)
          : base.geography.data_storage_locations,
    },
    technology: {
      cloud_providers:
        p.technology?.cloud_providers !== undefined
          ? cleanStringList(p.technology.cloud_providers)
          : base.technology.cloud_providers,
      critical_systems:
        p.technology?.critical_systems !== undefined
          ? cleanStringList(p.technology.critical_systems)
          : base.technology.critical_systems,
      data_types_processed:
        p.technology?.data_types_processed !== undefined
          ? cleanStringList(p.technology.data_types_processed)
          : base.technology.data_types_processed,
      payment_processing:
        p.technology?.payment_processing !== undefined
          ? normalizeBooleanOrTriState(p.technology.payment_processing, base.technology.payment_processing)
          : base.technology.payment_processing,
      third_party_processors:
        p.technology?.third_party_processors !== undefined
          ? cleanStringList(p.technology.third_party_processors)
          : base.technology.third_party_processors,
    },
    risk_context: {
      risk_profile: normalizeStringOrTriState(p.risk_context?.risk_profile, base.risk_context.risk_profile),
      sensitive_data_handled:
        p.risk_context?.sensitive_data_handled !== undefined
          ? normalizeBooleanOrTriState(p.risk_context.sensitive_data_handled, base.risk_context.sensitive_data_handled)
          : base.risk_context.sensitive_data_handled,
      critical_infrastructure:
        p.risk_context?.critical_infrastructure !== undefined
          ? normalizeBooleanOrTriState(p.risk_context.critical_infrastructure, base.risk_context.critical_infrastructure)
          : base.risk_context.critical_infrastructure,
      public_company_status:
        p.risk_context?.public_company_status !== undefined
          ? normalizeBooleanOrTriState(p.risk_context.public_company_status, base.risk_context.public_company_status)
          : base.risk_context.public_company_status,
      financial_institution_status:
        p.risk_context?.financial_institution_status !== undefined
          ? normalizeBooleanOrTriState(
              p.risk_context.financial_institution_status,
              base.risk_context.financial_institution_status
            )
          : base.risk_context.financial_institution_status,
    },
  };
}

export function computeProfileCompleteness(profile: StructuredCompanyProfile): ProfileCompleteness {
  const checks: Array<{ key: string; label: string; section: string; val: unknown }> = [
    { key: 'identity.legal_name', label: 'Legal entity name', section: 'Identity', val: profile.identity.legal_name },
    { key: 'identity.registration_number', label: 'Registration / entity ID', section: 'Identity', val: profile.identity.registration_number },
    { key: 'identity.country', label: 'Primary country', section: 'Identity', val: profile.identity.country },
    { key: 'identity.headquarters_location', label: 'Headquarters location', section: 'Identity', val: profile.identity.headquarters_location },

    { key: 'business.industry', label: 'Primary industry', section: 'Business', val: profile.business.industry },
    { key: 'business.company_type', label: 'Company / entity type', section: 'Business', val: profile.business.company_type },
    { key: 'business.business_activities', label: 'Business activities', section: 'Business', val: profile.business.business_activities },
    { key: 'business.products_services', label: 'Products & services', section: 'Business', val: profile.business.products_services },

    { key: 'scale.employee_count', label: 'Employee count', section: 'Scale', val: profile.scale.employee_count },
    { key: 'scale.annual_revenue', label: 'Annual revenue', section: 'Scale', val: profile.scale.annual_revenue },
    { key: 'scale.assets', label: 'Total assets', section: 'Scale', val: profile.scale.assets },

    { key: 'regulatory.licenses', label: 'Regulatory licenses / permits', section: 'Regulatory', val: profile.regulatory.licenses },
    { key: 'regulatory.regulatory_status', label: 'Regulatory status', section: 'Regulatory', val: profile.regulatory.regulatory_status },
    { key: 'regulatory.regulated_industries', label: 'Regulated industries', section: 'Regulatory', val: profile.regulatory.regulated_industries },

    { key: 'geography.countries_of_operation', label: 'Countries of operation', section: 'Geography', val: profile.geography.countries_of_operation },
    { key: 'geography.customer_locations', label: 'Customer locations', section: 'Geography', val: profile.geography.customer_locations },
    { key: 'geography.data_storage_locations', label: 'Data storage locations', section: 'Geography', val: profile.geography.data_storage_locations },

    { key: 'technology.cloud_providers', label: 'Cloud & hosting providers', section: 'Technology', val: profile.technology.cloud_providers },
    { key: 'technology.critical_systems', label: 'Critical systems', section: 'Technology', val: profile.technology.critical_systems },
    { key: 'technology.data_types_processed', label: 'Data types processed', section: 'Technology', val: profile.technology.data_types_processed },
    { key: 'technology.payment_processing', label: 'Payment processing flag', section: 'Technology', val: profile.technology.payment_processing },

    { key: 'risk_context.risk_profile', label: 'Risk tier', section: 'Risk Context', val: profile.risk_context.risk_profile },
    { key: 'risk_context.sensitive_data_handled', label: 'Sensitive data handled flag', section: 'Risk Context', val: profile.risk_context.sensitive_data_handled },
    { key: 'risk_context.financial_institution_status', label: 'Financial institution status', section: 'Risk Context', val: profile.risk_context.financial_institution_status },
  ];

  const sectionScores: Record<string, { populated: number; total: number; pct: number }> = {};
  const missingRecommendedFields: Array<{ key: string; label: string; section: string }> = [];
  let populatedCount = 0;

  for (const item of checks) {
    if (!sectionScores[item.section]) {
      sectionScores[item.section] = { populated: 0, total: 0, pct: 0 };
    }
    sectionScores[item.section].total += 1;
    // Note: NOT_APPLICABLE is an explicit resolved answer for completeness purposes; UNKNOWN / NOT_PROVIDED / empty are incomplete.
    const isPopulated = !isProfileMissingOrUnknown(item.val) || isExplicitlyNotApplicable(item.val);
    if (isPopulated) {
      populatedCount += 1;
      sectionScores[item.section].populated += 1;
    } else {
      missingRecommendedFields.push({ key: item.key, label: item.label, section: item.section });
    }
  }

  for (const sec of Object.keys(sectionScores)) {
    const s = sectionScores[sec];
    s.pct = s.total > 0 ? Math.round((s.populated / s.total) * 100) : 0;
  }

  const pct = Math.round((populatedCount / checks.length) * 100);
  return {
    pct,
    populatedCount,
    totalCount: checks.length,
    missingRecommendedFields,
    sectionScores,
  };
}

export function getCompanyProfile(orgId: string) {
  const org = db.prepare(`SELECT * FROM organizations WHERE id = ?`).get(orgId) as any;
  if (!org) return null;

  const row = db.prepare(`SELECT * FROM company_profiles WHERE organization_id = ?`).get(orgId) as any;
  const systems = db.prepare(`SELECT * FROM systems WHERE organization_id = ?`).all(orgId);

  const legacyProfile = row
    ? {
        business: JSON.parse(row.business_json || '{}'),
        data: JSON.parse(row.data_json || '{}'),
        infrastructure: JSON.parse(row.infrastructure_json || '{}'),
        compliance: JSON.parse(row.compliance_json || '{}'),
        updatedAt: row.updated_at,
      }
    : null;

  let structuredProfile: StructuredCompanyProfile;
  let versionNumber = row?.current_version_number || 1;

  if (row?.structured_profile_json) {
    const base = buildDefaultStructuredProfile(org, legacyProfile);
    structuredProfile = normalizeStructuredProfile(JSON.parse(row.structured_profile_json), base);
  } else {
    structuredProfile = buildDefaultStructuredProfile(org, legacyProfile);
    const now = row?.updated_at || new Date().toISOString();
    const completeness = computeProfileCompleteness(structuredProfile);
    if (row) {
      db.prepare(
        `UPDATE company_profiles SET structured_profile_json = ?, current_version_number = 1 WHERE organization_id = ?`
      ).run(JSON.stringify(structuredProfile), orgId);
    } else {
      db.prepare(
        `INSERT INTO company_profiles (
          organization_id, business_json, data_json, infrastructure_json, compliance_json,
          current_version_number, structured_profile_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        orgId,
        JSON.stringify({ products: structuredProfile.business.products_services, businessActivities: structuredProfile.business.business_activities }),
        JSON.stringify({ categories: structuredProfile.technology.data_types_processed }),
        JSON.stringify({ cloudProviders: structuredProfile.technology.cloud_providers, criticalSystems: structuredProfile.technology.critical_systems }),
        JSON.stringify({ regulators: [], certifications: [] }),
        JSON.stringify(structuredProfile),
        now
      );
    }

    const existingVerCount = (
      db.prepare(`SELECT COUNT(*) as c FROM company_profile_versions WHERE organization_id = ?`).get(orgId) as { c: number }
    ).c;
    if (existingVerCount === 0) {
      db.prepare(
        `INSERT INTO company_profile_versions (
          id, organization_id, version_number, profile_json, completeness_pct, changed_by, change_summary, created_at
        ) VALUES (?, ?, 1, ?, ?, 'System Initialization', 'Initial versioned company profile snapshot', ?)`
      ).run(`cpv_${crypto.randomUUID().slice(0, 10)}`, orgId, JSON.stringify(structuredProfile), completeness.pct, now);
    }
    versionNumber = 1;
  }

  const completeness = computeProfileCompleteness(structuredProfile);

  return {
    organization: org,
    structuredProfile,
    versionNumber,
    completeness,
    legacyProfile,
    systems,
    updatedAt: row?.updated_at || org.created_at,
  };
}

export function getCompanyProfileVersions(orgId: string) {
  return db
    .prepare(
      `SELECT id, organization_id, version_number, profile_json, completeness_pct, changed_by, change_summary, created_at
       FROM company_profile_versions
       WHERE organization_id = ?
       ORDER BY version_number DESC`
    )
    .all(orgId)
    .map((r: any) => ({
      ...r,
      profile: JSON.parse(r.profile_json),
    }));
}

export function saveCompanyProfile(params: {
  orgId: string;
  structuredPatch?: Partial<StructuredCompanyProfile> | Record<string, any>;
  legacyPayload?: {
    organization?: Record<string, any>;
    business?: Record<string, any>;
    data?: Record<string, any>;
    infrastructure?: Record<string, any>;
    compliance?: Record<string, any>;
  };
  completeOnboarding?: boolean;
  actorName: string;
  actorRole: string;
  changeSummary?: string;
}) {
  const current = getCompanyProfile(params.orgId);
  if (!current) {
    throw new Error('Organization not found.');
  }

  const now = new Date().toISOString();
  let baseProfile = current.structuredProfile;

  // Apply legacyOnboarding or legacy profile patch into structured profile seamlessly
  if (params.legacyPayload) {
    const lp = params.legacyPayload;
    const mappedPatch: any = {
      identity: {},
      business: {},
      scale: {},
      regulatory: {},
      geography: {},
      technology: {},
    };
    if (lp.organization) {
      if (lp.organization.name) mappedPatch.identity.legal_name = lp.organization.name;
      if (lp.organization.country) mappedPatch.identity.country = lp.organization.country;
      if (lp.organization.industry) mappedPatch.business.industry = lp.organization.industry;
      if (lp.organization.businessDescription) mappedPatch.business.business_model = lp.organization.businessDescription;
      if (lp.organization.size) mappedPatch.scale.employee_count = parseEmployeeCountFromSize(lp.organization.size);
      if (Array.isArray(lp.organization.operatingJurisdictions)) {
        mappedPatch.geography.countries_of_operation = lp.organization.operatingJurisdictions;
        mappedPatch.scale.operating_regions = lp.organization.operatingJurisdictions;
      }
    }
    if (lp.business) {
      if (lp.business.products) {
        mappedPatch.business.products_services = lp.business.products;
        mappedPatch.regulatory.regulated_products = lp.business.products;
      }
      if (lp.business.businessActivities) mappedPatch.business.business_activities = lp.business.businessActivities;
    }
    if (lp.data) {
      if (lp.data.categories) {
        mappedPatch.technology.data_types_processed = lp.data.categories;
        mappedPatch.regulatory.data_processing_activities = lp.data.categories;
      }
    }
    if (lp.infrastructure) {
      if (lp.infrastructure.cloudProviders) mappedPatch.technology.cloud_providers = lp.infrastructure.cloudProviders;
      if (lp.infrastructure.criticalSystems || lp.infrastructure.databases) {
        mappedPatch.technology.critical_systems = cleanStringList([
          ...(lp.infrastructure.criticalSystems || []),
          ...(lp.infrastructure.databases || []),
        ]);
      }
      if (lp.infrastructure.securitySystems) mappedPatch.technology.third_party_processors = lp.infrastructure.securitySystems;
    }
    if (lp.compliance) {
      if (Array.isArray(lp.compliance.regulators) && lp.compliance.regulators.length > 0) {
        mappedPatch.regulatory.regulatory_status = `Regulated (${lp.compliance.regulators.join(', ')})`;
      }
    }
    baseProfile = normalizeStructuredProfile(mappedPatch, baseProfile);
  }

  const nextStructured = normalizeStructuredProfile(params.structuredPatch, baseProfile);
  const completeness = computeProfileCompleteness(nextStructured);
  const nextVersionNumber = Number(current.versionNumber || 1) + 1;

  const existingLegacy = current.legacyProfile || {
    business: {},
    data: {},
    infrastructure: {},
    compliance: {},
  };

  const nextLegacyBusiness = {
    ...(existingLegacy.business || {}),
    ...(params.legacyPayload?.business || {}),
    products: nextStructured.business.products_services,
    businessActivities: nextStructured.business.business_activities,
  };
  const nextLegacyData = {
    ...(existingLegacy.data || {}),
    ...(params.legacyPayload?.data || {}),
    categories: nextStructured.technology.data_types_processed,
  };
  const nextLegacyInfra = {
    ...(existingLegacy.infrastructure || {}),
    ...(params.legacyPayload?.infrastructure || {}),
    cloudProviders: nextStructured.technology.cloud_providers,
    criticalSystems: nextStructured.technology.critical_systems,
  };
  const nextLegacyCompliance = {
    ...(existingLegacy.compliance || {}),
    ...(params.legacyPayload?.compliance || {}),
  };

  const jurisdictionsJson = JSON.stringify(
    nextStructured.geography.countries_of_operation.length > 0
      ? nextStructured.geography.countries_of_operation
      : [nextStructured.identity.country].filter((v) => !isProfileMissingOrUnknown(v))
  );

  const sizeDisplay =
    typeof nextStructured.scale.employee_count === 'number'
      ? `${nextStructured.scale.employee_count} employees`
      : params.legacyPayload?.organization?.size || current.organization.size;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE organizations
       SET name = ?,
           country = ?,
           industry = ?,
           size = ?,
           operating_jurisdictions = ?,
           business_description = ?,
           onboarding_completed = CASE WHEN ? = 1 THEN 1 ELSE onboarding_completed END
       WHERE id = ?`
    ).run(
      !isProfileMissingOrUnknown(nextStructured.identity.legal_name)
        ? nextStructured.identity.legal_name
        : current.organization.name,
      !isProfileMissingOrUnknown(nextStructured.identity.country)
        ? nextStructured.identity.country
        : current.organization.country,
      !isProfileMissingOrUnknown(nextStructured.business.industry)
        ? nextStructured.business.industry
        : current.organization.industry,
      sizeDisplay,
      jurisdictionsJson,
      !isProfileMissingOrUnknown(nextStructured.business.business_model)
        ? nextStructured.business.business_model
        : current.organization.business_description,
      params.completeOnboarding ? 1 : 0,
      params.orgId
    );

    db.prepare(
      `UPDATE company_profiles
       SET business_json = ?, data_json = ?, infrastructure_json = ?, compliance_json = ?,
           current_version_number = ?, structured_profile_json = ?, updated_at = ?
       WHERE organization_id = ?`
    ).run(
      JSON.stringify(nextLegacyBusiness),
      JSON.stringify(nextLegacyData),
      JSON.stringify(nextLegacyInfra),
      JSON.stringify(nextLegacyCompliance),
      nextVersionNumber,
      JSON.stringify(nextStructured),
      now,
      params.orgId
    );

    db.prepare(
      `INSERT INTO company_profile_versions (
        id, organization_id, version_number, profile_json, completeness_pct, changed_by, change_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `cpv_${crypto.randomUUID().slice(0, 10)}`,
      params.orgId,
      nextVersionNumber,
      JSON.stringify(nextStructured),
      completeness.pct,
      params.actorName,
      params.changeSummary || `Profile updated to v${nextVersionNumber} (${completeness.pct}% complete)`,
      now
    );

    // Mark prior applicability assessments stale so they can be re-evaluated cleanly
    db.prepare(
      `UPDATE obligation_applicability_assessments SET is_stale = 1 WHERE organization_id = ?`
    ).run(params.orgId);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  logAuditEvent({
    organizationId: params.orgId,
    actorName: params.actorName,
    actorRole: params.actorRole,
    action: params.completeOnboarding ? 'Onboarding & profile v' + nextVersionNumber + ' saved' : `Company profile updated (v${nextVersionNumber})`,
    objectType: 'CompanyProfile',
    objectId: params.orgId,
    objectLabel: `Profile v${nextVersionNumber}`,
    previousState: `v${current.versionNumber}`,
    newState: `v${nextVersionNumber} (${completeness.pct}% completeness)`,
    sourceRef: 'Company Profile Settings',
  });

  return getCompanyProfile(params.orgId)!;
}
