import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db.ts';
import { logAuditEvent } from './auth.ts';
import { retrieveRelevantDocumentChunks } from './ai.ts';
import {
  getCompanyProfile,
  isProfileMissingOrUnknown,
  type StructuredCompanyProfile,
} from './companyProfile.ts';

export type ApplicabilityDecision =
  | 'APPLIES'
  | 'DOES_NOT_APPLY'
  | 'POTENTIALLY_APPLIES'
  | 'INSUFFICIENT_INFORMATION'
  | 'REQUIRES_REVIEW';

export type ConfidenceLevel = 'High' | 'Medium' | 'Low';

export type ConditionType =
  | 'JURISDICTION'
  | 'STATE_PROVINCE'
  | 'INDUSTRY'
  | 'COMPANY_TYPE'
  | 'REVENUE'
  | 'EMPLOYEE_COUNT'
  | 'ASSETS'
  | 'BUSINESS_ACTIVITY'
  | 'REGULATED_PRODUCT'
  | 'LICENSE'
  | 'GEOGRAPHY'
  | 'DATA_TYPE'
  | 'CUSTOMER_TYPE'
  | 'REPORTING_STATUS'
  | 'PUBLIC_STATUS'
  | 'FINANCIAL_INSTITUTION_STATUS'
  | 'EXCLUSION';

export type ConditionOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'IN'
  | 'NOT_IN'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'CONTAINS'
  | 'IS_TRUE'
  | 'IS_FALSE';

export interface ApplicabilityCondition {
  id: string;
  condition_type: ConditionType;
  operator: ConditionOperator;
  field_path: string;
  expected_value: string | number | boolean | string[];
  is_exclusion?: boolean;
  hard_requirement?: boolean;
  description: string;
  source_reference?: string;
}

export interface EvaluatedConditionDetail {
  condition_id: string;
  condition_type: ConditionType;
  field_path: string;
  operator: ConditionOperator;
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

export interface AiApplicabilityOutput {
  decision: ApplicabilityDecision;
  confidence: ConfidenceLevel;
  reason: string;
  matched_conditions: string[];
  missing_information: string[];
  source_references: Array<{ source: string; section: string; excerpt: string }>;
  requires_human_review: boolean;
}

export class AiSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSchemaValidationError';
  }
}

export interface ApplicabilityAiProvider {
  providerName: string;
  modelName: string;
  isConfigured(): boolean;
  evaluateApplicability(input: {
    obligation: Record<string, any>;
    conditions: ApplicabilityCondition[];
    deterministicResult: DeterministicEvaluationResult;
    profile: StructuredCompanyProfile;
    excerpts: BoundedSourceExcerpt[];
  }): Promise<AiApplicabilityOutput>;
}

const VALID_DECISIONS = new Set<string>([
  'APPLIES',
  'DOES_NOT_APPLY',
  'POTENTIALLY_APPLIES',
  'INSUFFICIENT_INFORMATION',
  'REQUIRES_REVIEW',
]);

const VALID_CONFIDENCE = new Set<string>(['High', 'Medium', 'Low']);

export function validateAiApplicabilityOutput(raw: unknown): AiApplicabilityOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AiSchemaValidationError('AI applicability output must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  const decision = String(obj.decision || '').trim().toUpperCase();
  if (!VALID_DECISIONS.has(decision)) {
    throw new AiSchemaValidationError(`Invalid AI applicability decision "${String(obj.decision)}".`);
  }
  const confidenceRaw = String(obj.confidence || '').trim();
  const confidenceNorm = confidenceRaw.charAt(0).toUpperCase() + confidenceRaw.slice(1).toLowerCase();
  if (!VALID_CONFIDENCE.has(confidenceNorm)) {
    throw new AiSchemaValidationError(`Invalid AI confidence level "${String(obj.confidence)}".`);
  }
  if (typeof obj.reason !== 'string' || obj.reason.trim().length < 10) {
    throw new AiSchemaValidationError('AI applicability output must contain a grounded explanation in "reason".');
  }

  const matched = Array.isArray(obj.matched_conditions) ? obj.matched_conditions.map(String).filter(Boolean) : [];
  const missing = Array.isArray(obj.missing_information) ? obj.missing_information.map(String).filter(Boolean) : [];
  const refs = Array.isArray(obj.source_references)
    ? obj.source_references
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
        .map((r) => ({
          source: String(r.source || '').trim(),
          section: String(r.section || '').trim(),
          excerpt: String(r.excerpt || '').trim(),
        }))
        .filter((r) => r.source || r.excerpt)
    : [];

  if ((decision === 'APPLIES' || decision === 'DOES_NOT_APPLY') && refs.length === 0) {
    throw new AiSchemaValidationError(
      `AI applicability output with decision "${decision}" must cite at least one regulatory source reference.`
    );
  }

  return {
    decision: decision as ApplicabilityDecision,
    confidence: confidenceNorm as ConfidenceLevel,
    reason: obj.reason.trim(),
    matched_conditions: matched,
    missing_information: missing,
    source_references: refs,
    requires_human_review: Boolean(obj.requires_human_review),
  };
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export class GeminiApplicabilityAiProvider implements ApplicabilityAiProvider {
  providerName = 'gemini';
  modelName = 'gemini-4-hydrogen';

  isConfigured(): boolean {
    return createGeminiClient() !== null;
  }

  async evaluateApplicability(input: {
    obligation: Record<string, any>;
    conditions: ApplicabilityCondition[];
    deterministicResult: DeterministicEvaluationResult;
    profile: StructuredCompanyProfile;
    excerpts: BoundedSourceExcerpt[];
  }): Promise<AiApplicabilityOutput> {
    const ai = createGeminiClient();
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured for AI applicability analysis.');
    }

    const prompt = `You are a compliance applicability analyst providing decision support (not legal advice).
Evaluate whether the regulatory obligation below applies to the company profile based strictly on the structured conditions, company facts, and bounded regulatory excerpts provided.
Rules:
1. Never assume every regulation applies.
2. Do NOT guess if required thresholds, licenses, or business facts are UNKNOWN or NOT_PROVIDED — return INSUFFICIENT_INFORMATION.
3. Never contradict a clear jurisdictional or entity-type exclusion.
4. Always cite specific regulatory sections and excerpts in source_references.

OBLIGATION:
ID: ${input.obligation.id}
Title: ${input.obligation.title}
Regulator: ${input.obligation.regulator}
Jurisdiction: ${input.obligation.jurisdiction}
Required Action: ${input.obligation.required_action}
Responsible Entity: ${input.obligation.responsible_entity}
Source Reference: ${input.obligation.source_reference}

STRUCTURED CONDITIONS:
${JSON.stringify(input.conditions)}

DETERMINISTIC ENGINE PRELIMINARY RESULT:
${JSON.stringify({
  decision: input.deterministicResult.decision,
  matched: input.deterministicResult.matchedConditions.map((c) => c.explanation),
  failed: input.deterministicResult.failedConditions.map((c) => c.explanation),
  missing: input.deterministicResult.missingInformation,
})}

COMPANY PROFILE:
${JSON.stringify(input.profile)}

BOUNDED REGULATORY & INTERNAL EXCERPTS:
${input.excerpts.map((e) => `[${e.source_type} | ${e.title} | ${e.section} | ${e.version}]: ${e.excerpt}`).join('\n\n')}
`;

    const response = await ai.models.generateContent({
      model: this.modelName,
      contents: prompt,
      config: {
        systemInstruction:
          'Return strict JSON complying with the schema. Do not fabricate facts, thresholds, or citations outside the provided excerpts.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            decision: {
              type: Type.STRING,
              description:
                'One of: APPLIES, DOES_NOT_APPLY, POTENTIALLY_APPLIES, INSUFFICIENT_INFORMATION, REQUIRES_REVIEW',
            },
            confidence: {
              type: Type.STRING,
              description: 'One of: High, Medium, Low',
            },
            reason: { type: Type.STRING },
            matched_conditions: { type: Type.ARRAY, items: { type: Type.STRING } },
            missing_information: { type: Type.ARRAY, items: { type: Type.STRING } },
            source_references: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  source: { type: Type.STRING },
                  section: { type: Type.STRING },
                  excerpt: { type: Type.STRING },
                },
              },
            },
            requires_human_review: { type: Type.BOOLEAN },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return validateAiApplicabilityOutput(parsed);
  }
}

export const applicabilityAiProvider = new GeminiApplicabilityAiProvider();

export function extractStructuredConditions(obligationRow: Record<string, any>): ApplicabilityCondition[] {
  let raw: Record<string, any> = {};
  try {
    raw = JSON.parse(String(obligationRow.applicability_conditions_json || '{}'));
  } catch {
    raw = {};
  }

  const srcRef = String(obligationRow.source_reference || obligationRow.regulatory_identifier || '');

  // Prefer explicit structured rules when stored on obligation
  if (Array.isArray(raw.rules) && raw.rules.length > 0) {
    return raw.rules.map((r: any, idx: number) => ({
      id: String(r.id || `cond_${idx + 1}`),
      condition_type: String(r.condition_type || 'INDUSTRY').toUpperCase() as ConditionType,
      operator: String(r.operator || 'CONTAINS').toUpperCase() as ConditionOperator,
      field_path: String(r.field_path || 'business.industry'),
      expected_value: r.expected_value,
      is_exclusion: Boolean(r.is_exclusion),
      hard_requirement: r.hard_requirement !== false,
      description: String(r.description || `${r.condition_type} ${r.operator} ${JSON.stringify(r.expected_value)}`),
      source_reference: String(r.source_reference || srcRef),
    }));
  }

  // Deterministically normalize legacy applicability_conditions objects into explicit structured rules
  const conditions: ApplicabilityCondition[] = [];
  const country = raw.country || obligationRow.jurisdiction;
  if (country) {
    conditions.push({
      id: 'cond_jurisdiction',
      condition_type: 'JURISDICTION',
      operator: 'IN',
      field_path: 'geography.countries_of_operation',
      expected_value: Array.isArray(country) ? country : [String(country)],
      hard_requirement: true,
      description: `Organization operates in or serves customers in ${Array.isArray(country) ? country.join(', ') : country}`,
      source_reference: srcRef,
    });
  }

  if (raw.state_province) {
    conditions.push({
      id: 'cond_state_province',
      condition_type: 'STATE_PROVINCE',
      operator: 'IN',
      field_path: 'geography.states_provinces_regions',
      expected_value: Array.isArray(raw.state_province) ? raw.state_province : [String(raw.state_province)],
      hard_requirement: true,
      description: `Organization operates in state/province: ${raw.state_province}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.industries) && raw.industries.length > 0) {
    conditions.push({
      id: 'cond_industry',
      condition_type: 'INDUSTRY',
      operator: 'IN',
      field_path: 'business.industry',
      expected_value: raw.industries.map(String),
      hard_requirement: true,
      description: `Primary or regulated industry matches: ${raw.industries.join(', ')}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.company_types) && raw.company_types.length > 0) {
    conditions.push({
      id: 'cond_company_type',
      condition_type: 'COMPANY_TYPE',
      operator: 'IN',
      field_path: 'business.company_type',
      expected_value: raw.company_types.map(String),
      hard_requirement: true,
      description: `Entity / company type matches: ${raw.company_types.join(', ')}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.licenses) && raw.licenses.length > 0) {
    conditions.push({
      id: 'cond_license',
      condition_type: 'LICENSE',
      operator: 'CONTAINS',
      field_path: 'regulatory.licenses',
      expected_value: raw.licenses.map(String),
      hard_requirement: true,
      description: `Organization holds regulatory license: ${raw.licenses.join(', ')}`,
      source_reference: srcRef,
    });
  }

  if (typeof raw.annual_revenue_gt === 'number') {
    conditions.push({
      id: 'cond_revenue_gt',
      condition_type: 'REVENUE',
      operator: 'GREATER_THAN',
      field_path: 'scale.annual_revenue',
      expected_value: raw.annual_revenue_gt,
      hard_requirement: true,
      description: `Annual revenue exceeds ${raw.annual_revenue_gt.toLocaleString()}`,
      source_reference: srcRef,
    });
  }

  if (typeof raw.employee_count_gte === 'number') {
    conditions.push({
      id: 'cond_employee_gte',
      condition_type: 'EMPLOYEE_COUNT',
      operator: 'GREATER_THAN_OR_EQUAL',
      field_path: 'scale.employee_count',
      expected_value: raw.employee_count_gte,
      hard_requirement: true,
      description: `Employee count >= ${raw.employee_count_gte}`,
      source_reference: srcRef,
    });
  }

  if (typeof raw.assets_gt === 'number') {
    conditions.push({
      id: 'cond_assets_gt',
      condition_type: 'ASSETS',
      operator: 'GREATER_THAN',
      field_path: 'scale.assets',
      expected_value: raw.assets_gt,
      hard_requirement: true,
      description: `Total assets exceed ${raw.assets_gt.toLocaleString()}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.business_activities) && raw.business_activities.length > 0) {
    conditions.push({
      id: 'cond_activity',
      condition_type: 'BUSINESS_ACTIVITY',
      operator: 'CONTAINS',
      field_path: 'business.business_activities',
      expected_value: raw.business_activities.map(String),
      hard_requirement: false,
      description: `Conducts business activities: ${raw.business_activities.join(', ')}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.data_types) && raw.data_types.length > 0) {
    conditions.push({
      id: 'cond_data_type',
      condition_type: 'DATA_TYPE',
      operator: 'CONTAINS',
      field_path: 'technology.data_types_processed',
      expected_value: raw.data_types.map(String),
      hard_requirement: false,
      description: `Processes data categories: ${raw.data_types.join(', ')}`,
      source_reference: srcRef,
    });
  }

  if (Array.isArray(raw.exclusions) && raw.exclusions.length > 0) {
    conditions.push({
      id: 'cond_exclusion',
      condition_type: 'EXCLUSION',
      operator: 'IN',
      field_path: 'business.company_type',
      expected_value: raw.exclusions.map(String),
      is_exclusion: true,
      hard_requirement: true,
      description: `Excluded entity types: ${raw.exclusions.join(', ')}`,
      source_reference: srcRef,
    });
  }

  return conditions;
}

function getProfileFieldValue(profile: StructuredCompanyProfile, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
  let cur: any = profile;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }

  // Enrich jurisdiction lookup with identity.country + customer_locations
  if (fieldPath === 'geography.countries_of_operation') {
    const combined = [
      ...(Array.isArray(profile.geography.countries_of_operation) ? profile.geography.countries_of_operation : []),
      ...(Array.isArray(profile.geography.customer_locations) ? profile.geography.customer_locations : []),
      ...(Array.isArray(profile.scale.operating_regions) ? profile.scale.operating_regions : []),
      ...(!isProfileMissingOrUnknown(profile.identity.country) ? [profile.identity.country] : []),
    ];
    return Array.from(new Set(combined.filter(Boolean)));
  }

  // Enrich industry lookup with business.industry + regulatory.regulated_industries
  if (fieldPath === 'business.industry') {
    const combined = [
      ...(!isProfileMissingOrUnknown(profile.business.industry) ? [profile.business.industry] : []),
      ...(Array.isArray(profile.regulatory.regulated_industries) ? profile.regulatory.regulated_industries : []),
    ];
    return Array.from(new Set(combined.filter(Boolean)));
  }

  return cur;
}

function normalizeToken(val: unknown): string {
  return String(val || '')
    .trim()
    .toLowerCase();
}

function textListMatches(actualVal: unknown, expectedVal: unknown): boolean {
  const actualArr = Array.isArray(actualVal)
    ? actualVal.map(normalizeToken).filter(Boolean)
    : !isProfileMissingOrUnknown(actualVal)
    ? [normalizeToken(actualVal)]
    : [];

  const expectedArr = Array.isArray(expectedVal) ? expectedVal.map(normalizeToken).filter(Boolean) : [normalizeToken(expectedVal)];
  if (actualArr.length === 0 || expectedArr.length === 0) return false;

  for (const exp of expectedArr) {
    for (const act of actualArr) {
      if (act === exp || act.includes(exp) || exp.includes(act)) {
        return true;
      }
      // Split compound labels like "Financial Technology / Digital Payments"
      const actParts = act.split(/[/,;]+/).map((p) => p.trim()).filter(Boolean);
      if (actParts.some((p) => p === exp || p.includes(exp) || exp.includes(p))) {
        return true;
      }
    }
  }
  return false;
}

export interface DeterministicEvaluationResult {
  decision: ApplicabilityDecision;
  confidenceLevel: ConfidenceLevel;
  confidenceScore: number;
  reasoningSummary: string;
  matchedConditions: EvaluatedConditionDetail[];
  failedConditions: EvaluatedConditionDetail[];
  missingInformation: string[];
  hasHardExclusionOrMismatch: boolean;
}

export function evaluateDeterministicApplicability(
  profile: StructuredCompanyProfile,
  conditions: ApplicabilityCondition[],
  obligationRow: Record<string, any>
): DeterministicEvaluationResult {
  const matchedConditions: EvaluatedConditionDetail[] = [];
  const failedConditions: EvaluatedConditionDetail[] = [];
  const missingInformation: string[] = [];

  if (conditions.length === 0) {
    return {
      decision: 'REQUIRES_REVIEW',
      confidenceLevel: 'Low',
      confidenceScore: 0.35,
      reasoningSummary: 'No structured applicability conditions defined on this obligation; human review required.',
      matchedConditions,
      failedConditions,
      missingInformation: ['Structured applicability rules or regulatory scope parameters'],
      hasHardExclusionOrMismatch: false,
    };
  }

  let hasHardFailure = false;
  let hasExclusionTriggered = false;

  for (const cond of conditions) {
    const actualVal = getProfileFieldValue(profile, cond.field_path);
    const missing = isProfileMissingOrUnknown(actualVal);

    if (cond.is_exclusion || cond.condition_type === 'EXCLUSION') {
      if (missing) {
        // Cannot verify exclusion if field unknown, note softly unless another rule settles it
        continue;
      }
      const matchesExcluded = textListMatches(actualVal, cond.expected_value);
      if (matchesExcluded) {
        hasExclusionTriggered = true;
        hasHardFailure = true;
        failedConditions.push({
          condition_id: cond.id,
          condition_type: cond.condition_type,
          field_path: cond.field_path,
          operator: cond.operator,
          expected_value: cond.expected_value,
          actual_value: actualVal,
          status: 'EXCLUDED',
          explanation: `Exclusion condition triggered: ${cond.description} (profile value: ${JSON.stringify(actualVal)}).`,
          source_reference: cond.source_reference,
        });
      } else {
        matchedConditions.push({
          condition_id: cond.id,
          condition_type: cond.condition_type,
          field_path: cond.field_path,
          operator: cond.operator,
          expected_value: cond.expected_value,
          actual_value: actualVal,
          status: 'MATCHED',
          explanation: `Not excluded (${cond.description}).`,
          source_reference: cond.source_reference,
        });
      }
      continue;
    }

    if (missing) {
      missingInformation.push(`${cond.field_path}: needed to evaluate "${cond.description}"`);
      continue;
    }

    let passed = false;
    switch (cond.operator) {
      case 'EQUALS':
      case 'IN':
      case 'CONTAINS':
        passed = textListMatches(actualVal, cond.expected_value);
        break;
      case 'NOT_EQUALS':
      case 'NOT_IN':
        passed = !textListMatches(actualVal, cond.expected_value);
        break;
      case 'GREATER_THAN': {
        const num = typeof actualVal === 'number' ? actualVal : Number(actualVal);
        const exp = Number(cond.expected_value);
        if (!Number.isFinite(num)) {
          missingInformation.push(`${cond.field_path}: numeric value required to evaluate "${cond.description}"`);
          continue;
        }
        passed = num > exp;
        break;
      }
      case 'GREATER_THAN_OR_EQUAL': {
        const num = typeof actualVal === 'number' ? actualVal : Number(actualVal);
        const exp = Number(cond.expected_value);
        if (!Number.isFinite(num)) {
          missingInformation.push(`${cond.field_path}: numeric value required to evaluate "${cond.description}"`);
          continue;
        }
        passed = num >= exp;
        break;
      }
      case 'LESS_THAN': {
        const num = typeof actualVal === 'number' ? actualVal : Number(actualVal);
        const exp = Number(cond.expected_value);
        if (!Number.isFinite(num)) {
          missingInformation.push(`${cond.field_path}: numeric value required to evaluate "${cond.description}"`);
          continue;
        }
        passed = num < exp;
        break;
      }
      case 'IS_TRUE':
        passed = actualVal === true;
        break;
      case 'IS_FALSE':
        passed = actualVal === false;
        break;
      default:
        passed = textListMatches(actualVal, cond.expected_value);
    }

    if (passed) {
      matchedConditions.push({
        condition_id: cond.id,
        condition_type: cond.condition_type,
        field_path: cond.field_path,
        operator: cond.operator,
        expected_value: cond.expected_value,
        actual_value: actualVal,
        status: 'MATCHED',
        explanation: `Matched: ${cond.description} (company value: ${JSON.stringify(actualVal)}).`,
        source_reference: cond.source_reference,
      });
    } else {
      if (cond.hard_requirement !== false) {
        hasHardFailure = true;
      }
      failedConditions.push({
        condition_id: cond.id,
        condition_type: cond.condition_type,
        field_path: cond.field_path,
        operator: cond.operator,
        expected_value: cond.expected_value,
        actual_value: actualVal,
        status: 'FAILED',
        explanation: `Not satisfied: ${cond.description} (company value: ${JSON.stringify(actualVal)}).`,
        source_reference: cond.source_reference,
      });
    }
  }

  // Determine deterministic verdict strictly without guessing
  let decision: ApplicabilityDecision;
  let confidenceLevel: ConfidenceLevel;
  let confidenceScore: number;
  let reasoningSummary: string;

  if (hasExclusionTriggered || hasHardFailure) {
    decision = 'DOES_NOT_APPLY';
    confidenceLevel = 'High';
    confidenceScore = 0.94;
    const primaryFail = failedConditions[0]?.explanation || 'Mandatory scope condition was not met.';
    reasoningSummary = `Does not apply: ${primaryFail}`;
  } else if (missingInformation.length > 0) {
    decision = 'INSUFFICIENT_INFORMATION';
    confidenceLevel = matchedConditions.length > 0 ? 'Medium' : 'Low';
    confidenceScore = matchedConditions.length > 0 ? 0.45 : 0.25;
    reasoningSummary = `Insufficient company profile information to conclude applicability (${missingInformation.length} missing field${missingInformation.length > 1 ? 's' : ''}): ${missingInformation.join('; ')}.`;
  } else if (failedConditions.length > 0) {
    decision = 'POTENTIALLY_APPLIES';
    confidenceLevel = 'Medium';
    confidenceScore = 0.62;
    reasoningSummary = `Core jurisdictional/entity rules matched, but optional operational scope condition differs: ${failedConditions.map((f) => f.explanation).join(' ')}`;
  } else {
    decision = 'APPLIES';
    confidenceLevel = 'High';
    confidenceScore = 0.92;
    reasoningSummary = `Applies to ${profile.identity.legal_name} (${obligationRow.regulator} · ${obligationRow.jurisdiction}): all ${matchedConditions.length} applicability conditions matched.`;
  }

  return {
    decision,
    confidenceLevel,
    confidenceScore,
    reasoningSummary,
    matchedConditions,
    failedConditions,
    missingInformation,
    hasHardExclusionOrMismatch: hasExclusionTriggered || hasHardFailure,
  };
}

export function retrieveObligationContext(
  obligationRow: Record<string, any>,
  organizationId: string
): BoundedSourceExcerpt[] {
  const excerpts: BoundedSourceExcerpt[] = [];
  const version = db
    .prepare(
      `SELECT id, version_number, title, regulatory_identifier, extracted_text, sections_json
       FROM regulatory_document_versions WHERE id = ?`
    )
    .get(obligationRow.regulation_version_id) as any;

  if (version) {
    let sections: Array<{ section: string; heading: string; text: string }> = [];
    try {
      sections = JSON.parse(version.sections_json || '[]');
    } catch {
      sections = [];
    }

    const refLower = String(obligationRow.source_reference || '').toLowerCase();
    const titleWords = `${obligationRow.title} ${obligationRow.required_action}`
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const scoredSections = sections.map((sec) => {
      const hay = `${sec.section} ${sec.heading} ${sec.text}`.toLowerCase();
      let score = 0;
      if (sec.section && refLower.includes(sec.section.toLowerCase())) score += 10;
      if (/scope|applicab|definition|exempt|exception|threshold|entity|covered/i.test(`${sec.heading} ${sec.text}`)) score += 4;
      for (const w of titleWords) {
        if (hay.includes(w)) score += 1;
      }
      return { sec, score };
    });

    const topSections = scoredSections
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.sec);

    for (const sec of topSections) {
      excerpts.push({
        source_type: 'REGULATION_SECTION',
        title: `${version.regulatory_identifier} — ${version.title}`,
        section: `Section ${sec.section}: ${sec.heading}`.trim(),
        version: `v${version.version_number}`,
        excerpt: sec.text.slice(0, 1200),
      });
    }

    if (excerpts.length === 0 && version.extracted_text) {
      excerpts.push({
        source_type: 'REGULATION_SECTION',
        title: `${version.regulatory_identifier} — ${version.title}`,
        section: String(obligationRow.source_reference || 'Primary Clause'),
        version: `v${version.version_number}`,
        excerpt: String(version.extracted_text).slice(0, 1500),
      });
    }
  }

  // Also include strictly org-scoped internal document chunks matching the obligation topic
  const internalChunks = retrieveRelevantDocumentChunks(
    organizationId,
    `${obligationRow.title} ${obligationRow.required_action}`,
    2
  );
  for (const ch of internalChunks) {
    if (ch.score > 0) {
      excerpts.push({
        source_type: 'INTERNAL_DOCUMENT',
        title: `${ch.filename} (${ch.classification})`,
        section: 'Indexed Internal Policy Excerpt',
        version: 'Current',
        excerpt: ch.content.slice(0, 800),
      });
    }
  }

  return excerpts;
}

export async function analyzeObligationApplicability(params: {
  orgId: string;
  obligationId: string;
  useAi?: boolean;
  changeId?: string | null;
  aiProvider?: ApplicabilityAiProvider;
}) {
  const profileState = getCompanyProfile(params.orgId);
  if (!profileState) {
    throw new Error('Organization profile not found.');
  }

  const obligationRow = db
    .prepare(
      `SELECT ro.*, rd.regulatory_identifier, rd.title as regulation_title, rv.version_number
       FROM regulatory_obligations ro
       JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       JOIN regulatory_document_versions rv ON rv.id = ro.regulation_version_id
       WHERE ro.id = ?`
    )
    .get(params.obligationId) as any;

  if (!obligationRow) {
    throw new Error(`Regulatory obligation "${params.obligationId}" not found.`);
  }

  const conditions = extractStructuredConditions(obligationRow);
  const detResult = evaluateDeterministicApplicability(profileState.structuredProfile, conditions, obligationRow);
  const excerpts = retrieveObligationContext(obligationRow, params.orgId);

  let finalDecision: ApplicabilityDecision = detResult.decision;
  let confidenceLevel: ConfidenceLevel = detResult.confidenceLevel;
  let confidenceScore = detResult.confidenceScore;
  let reasoningSummary = detResult.reasoningSummary;
  let missingInformation = [...detResult.missingInformation];
  let evaluationMethod = 'DETERMINISTIC';
  let modelProvider: string | null = null;
  let modelName: string | null = null;
  let requiresHumanReview =
    finalDecision === 'POTENTIALLY_APPLIES' ||
    finalDecision === 'REQUIRES_REVIEW' ||
    finalDecision === 'INSUFFICIENT_INFORMATION';
  const conflictingConditions: string[] = [];

  const sourceRefs = excerpts
    .filter((e) => e.source_type === 'REGULATION_SECTION')
    .map((e) => ({
      source: e.title,
      section: e.section,
      excerpt: e.excerpt.slice(0, 320),
    }));

  const provider = params.aiProvider || applicabilityAiProvider;
  const shouldRunAi = Boolean(params.useAi) && provider.isConfigured();

  if (shouldRunAi) {
    const aiOut = await provider.evaluateApplicability({
      obligation: obligationRow,
      conditions,
      deterministicResult: detResult,
      profile: profileState.structuredProfile,
      excerpts,
    });

    modelProvider = provider.providerName;
    modelName = provider.modelName;

    // INVARIANT: AI must NEVER override a deterministic hard exclusion / mismatch into APPLIES
    if (
      detResult.hasHardExclusionOrMismatch &&
      detResult.decision === 'DOES_NOT_APPLY' &&
      (aiOut.decision === 'APPLIES' || aiOut.decision === 'POTENTIALLY_APPLIES')
    ) {
      conflictingConditions.push(
        `Deterministic rule engine returned DOES_NOT_APPLY (${detResult.failedConditions.map((f) => f.explanation).join('; ')}), conflicting with AI output "${aiOut.decision}".`
      );
      finalDecision = 'REQUIRES_REVIEW';
      confidenceLevel = 'Low';
      confidenceScore = 0.4;
      requiresHumanReview = true;
      evaluationMethod = 'HYBRID_CONFLICT_ESCALATION';
      reasoningSummary = `Conflict detected between deterministic applicability rules and AI interpretation. Deterministic rules found: ${detResult.reasoningSummary} AI suggested: ${aiOut.reason}`;
    } else {
      finalDecision = aiOut.decision;
      confidenceLevel = aiOut.confidence;
      confidenceScore = aiOut.confidence === 'High' ? 0.9 : aiOut.confidence === 'Medium' ? 0.65 : 0.35;
      reasoningSummary = aiOut.reason;
      if (aiOut.missing_information.length > 0) {
        missingInformation = Array.from(new Set([...missingInformation, ...aiOut.missing_information]));
      }
      if (aiOut.source_references.length > 0) {
        sourceRefs.splice(0, sourceRefs.length, ...aiOut.source_references);
      }
      requiresHumanReview =
        aiOut.requires_human_review ||
        finalDecision === 'POTENTIALLY_APPLIES' ||
        finalDecision === 'REQUIRES_REVIEW' ||
        finalDecision === 'INSUFFICIENT_INFORMATION';
      evaluationMethod = 'HYBRID_DETERMINISTIC_AND_AI';
    }
  } else if (params.useAi && !provider.isConfigured()) {
    throw new Error('AI applicability analysis requires GEMINI_API_KEY in Secrets.');
  }

  const now = new Date().toISOString();
  const assessmentId = `oapp_${crypto.randomUUID().slice(0, 10)}`;
  const reviewStatus =
    finalDecision === 'APPLIES' || finalDecision === 'DOES_NOT_APPLY'
      ? 'AUTO_ASSESSED'
      : 'PENDING_REVIEW';

  // Immutable insert — never overwrites historical assessments
  db.prepare(
    `INSERT INTO obligation_applicability_assessments (
      id, organization_id, obligation_id, regulation_id, regulation_version_id, change_id,
      decision, confidence_level, confidence_score, evaluation_method, deterministic_decision,
      reasoning_summary, matched_conditions_json, failed_conditions_json, conflicting_conditions_json,
      missing_information_json, source_references_json, relevant_excerpts_json, evaluated_profile_version,
      model_provider, model_name, requires_human_review, human_review_status, human_override_decision,
      reviewer_name, review_comment, reviewed_at, is_stale, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0, ?)`
  ).run(
    assessmentId,
    params.orgId,
    obligationRow.id,
    obligationRow.regulation_id,
    obligationRow.regulation_version_id,
    params.changeId ?? obligationRow.change_id ?? null,
    finalDecision,
    confidenceLevel,
    confidenceScore,
    evaluationMethod,
    detResult.decision,
    reasoningSummary,
    JSON.stringify(detResult.matchedConditions),
    JSON.stringify(detResult.failedConditions),
    JSON.stringify(conflictingConditions),
    JSON.stringify(missingInformation),
    JSON.stringify(sourceRefs),
    JSON.stringify(excerpts),
    profileState.versionNumber,
    modelProvider,
    modelName,
    requiresHumanReview ? 1 : 0,
    reviewStatus,
    now
  );

  return formatAssessmentRow(
    db.prepare(`SELECT * FROM obligation_applicability_assessments WHERE id = ?`).get(assessmentId) as any
  );
}

export function formatAssessmentRow(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    organization_id: row.organization_id,
    obligation_id: row.obligation_id,
    regulation_id: row.regulation_id,
    regulation_version_id: row.regulation_version_id,
    change_id: row.change_id,
    decision: row.decision as ApplicabilityDecision,
    effective_decision: (row.human_override_decision || row.decision) as ApplicabilityDecision,
    confidence_level: row.confidence_level as ConfidenceLevel,
    confidence_score: row.confidence_score,
    evaluation_method: row.evaluation_method,
    deterministic_decision: row.deterministic_decision,
    reasoning_summary: row.reasoning_summary,
    matched_conditions: JSON.parse(row.matched_conditions_json || '[]'),
    failed_conditions: JSON.parse(row.failed_conditions_json || '[]'),
    conflicting_conditions: JSON.parse(row.conflicting_conditions_json || '[]'),
    missing_information: JSON.parse(row.missing_information_json || '[]'),
    source_references: JSON.parse(row.source_references_json || '[]'),
    relevant_excerpts: JSON.parse(row.relevant_excerpts_json || '[]'),
    evaluated_profile_version: row.evaluated_profile_version,
    model_provider: row.model_provider,
    model_name: row.model_name,
    requires_human_review: Boolean(row.requires_human_review),
    human_review_status: row.human_review_status,
    human_override_decision: row.human_override_decision,
    reviewer_name: row.reviewer_name,
    review_comment: row.review_comment,
    reviewed_at: row.reviewed_at,
    is_stale: Boolean(row.is_stale),
    evaluated_at: row.evaluated_at,
  };
}

export function getLatestAssessmentsMapForOrg(orgId: string): Map<string, ReturnType<typeof formatAssessmentRow>> {
  const rows = db
    .prepare(
      `SELECT * FROM obligation_applicability_assessments
       WHERE organization_id = ?
       ORDER BY evaluated_at DESC, rowid DESC`
    )
    .all(orgId) as Array<any>;

  const map = new Map<string, ReturnType<typeof formatAssessmentRow>>();
  for (const row of rows) {
    if (!map.has(row.obligation_id)) {
      map.set(row.obligation_id, formatAssessmentRow(row));
    }
  }
  return map;
}

export async function recalculateAllObligationsForOrg(
  orgId: string,
  options: { useAi?: boolean; onlyObligationIds?: string[] } = {}
) {
  const obs = db
    .prepare(
      `SELECT ro.id
       FROM regulatory_obligations ro
       JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       WHERE ro.regulation_version_id = rd.current_version_id`
    )
    .all() as Array<{ id: string }>;

  const targetIds = options.onlyObligationIds
    ? obs.filter((o) => options.onlyObligationIds!.includes(o.id)).map((o) => o.id)
    : obs.map((o) => o.id);

  const results = [];
  for (const oblId of targetIds) {
    const res = await analyzeObligationApplicability({
      orgId,
      obligationId: oblId,
      useAi: Boolean(options.useAi),
    });
    if (res) results.push(res);
  }
  return results;
}

export async function evaluateChangeAcrossOrganizations(changeId: string) {
  const change = db.prepare(`SELECT * FROM regulatory_changes WHERE id = ?`).get(changeId) as any;
  if (!change) return [];

  const changedObligations = db
    .prepare(`SELECT id, title FROM regulatory_obligations WHERE change_id = ? OR regulation_version_id = ?`)
    .all(changeId, change.new_version_id) as Array<{ id: string; title: string }>;

  if (changedObligations.length === 0) return [];

  const orgs = db.prepare(`SELECT id, name FROM organizations`).all() as Array<{ id: string; name: string }>;
  const evaluations: Array<{ orgId: string; obligationId: string; decision: ApplicabilityDecision }> = [];
  const now = new Date().toISOString();

  for (const org of orgs) {
    let newlyApplicableCount = 0;
    let needsReviewCount = 0;
    for (const obl of changedObligations) {
      try {
        const assessment = await analyzeObligationApplicability({
          orgId: org.id,
          obligationId: obl.id,
          useAi: false,
          changeId,
        });
        if (assessment) {
          evaluations.push({ orgId: org.id, obligationId: obl.id, decision: assessment.decision });
          if (assessment.decision === 'APPLIES') newlyApplicableCount += 1;
          if (
            assessment.decision === 'POTENTIALLY_APPLIES' ||
            assessment.decision === 'REQUIRES_REVIEW' ||
            assessment.decision === 'INSUFFICIENT_INFORMATION'
          ) {
            needsReviewCount += 1;
          }
        }
      } catch {
        // Isolate per-org evaluation failures cleanly
      }
    }

    if (newlyApplicableCount > 0 || needsReviewCount > 0) {
      db.prepare(
        `INSERT INTO notifications (id, organization_id, title, message, category, link_view, link_id, is_read, created_at)
         VALUES (?, ?, ?, ?, 'Applicability', 'applicability', ?, 0, ?)`
      ).run(
        `ntf_${crypto.randomUUID().slice(0, 10)}`,
        org.id,
        `Regulatory Change Applicability Impact: ${change.regulatory_identifier}`,
        `${newlyApplicableCount} applicable and ${needsReviewCount} review-needed obligations detected from ${change.regulatory_identifier}.`,
        changedObligations[0]?.id || null,
        now
      );
    }
  }

  return evaluations;
}

export function reviewObligationAssessment(params: {
  orgId: string;
  obligationId: string;
  action: 'APPROVE' | 'REJECT' | 'REQUEST_MORE_INFO' | 'OVERRIDE' | 'COMMENT';
  overrideDecision?: ApplicabilityDecision;
  comment?: string;
  reviewerName: string;
  reviewerRole: string;
}) {
  const latest = db
    .prepare(
      `SELECT * FROM obligation_applicability_assessments
       WHERE organization_id = ? AND obligation_id = ?
       ORDER BY evaluated_at DESC, rowid DESC LIMIT 1`
    )
    .get(params.orgId, params.obligationId) as any;

  if (!latest) {
    throw new Error('No applicability assessment exists yet for this obligation.');
  }

  const now = new Date().toISOString();
  let nextReviewStatus = latest.human_review_status;
  let nextOverride = latest.human_override_decision;

  if (params.action === 'APPROVE') {
    nextReviewStatus = 'APPROVED';
  } else if (params.action === 'REJECT') {
    nextReviewStatus = 'REJECTED';
  } else if (params.action === 'REQUEST_MORE_INFO') {
    nextReviewStatus = 'MORE_INFO_REQUESTED';
  } else if (params.action === 'OVERRIDE') {
    if (!params.overrideDecision || !VALID_DECISIONS.has(params.overrideDecision)) {
      throw new Error('Valid overrideDecision is required for OVERRIDE action.');
    }
    nextReviewStatus = 'OVERRIDDEN';
    nextOverride = params.overrideDecision;
  } else if (params.action === 'COMMENT') {
    nextReviewStatus = latest.human_review_status === 'AUTO_ASSESSED' ? 'COMMENTED' : latest.human_review_status;
  }

  // CRITICAL INVARIANT: Never overwrite `decision`, `deterministic_decision`, or `reasoning_summary` (AI/engine output preserved!)
  db.prepare(
    `UPDATE obligation_applicability_assessments
     SET human_review_status = ?,
         human_override_decision = ?,
         reviewer_name = ?,
         review_comment = ?,
         reviewed_at = ?
     WHERE id = ? AND organization_id = ?`
  ).run(
    nextReviewStatus,
    nextOverride,
    params.reviewerName,
    params.comment ? params.comment.trim() : latest.review_comment,
    now,
    latest.id,
    params.orgId
  );

  logAuditEvent({
    organizationId: params.orgId,
    actorName: params.reviewerName,
    actorRole: params.reviewerRole,
    action: `Applicability review: ${params.action}`,
    objectType: 'ApplicabilityAssessment',
    objectId: params.obligationId,
    objectLabel: `Assessment ${latest.id}`,
    previousState: latest.decision,
    newState: nextOverride ? `OVERRIDE -> ${nextOverride}` : nextReviewStatus,
    sourceRef: 'Applicability Engine Review',
  });

  const updated = db.prepare(`SELECT * FROM obligation_applicability_assessments WHERE id = ?`).get(latest.id);
  return formatAssessmentRow(updated);
}

export function getApplicabilityQueueAndSummary(orgId: string) {
  const obligations = db
    .prepare(
      `SELECT ro.*, rd.regulatory_identifier, rd.title as regulation_title, rd.document_type,
              rd.publication_date, rd.effective_date, rd.source_url, rv.version_number
       FROM regulatory_obligations ro
       JOIN regulatory_documents rd ON rd.id = ro.regulation_id
       JOIN regulatory_document_versions rv ON rv.id = ro.regulation_version_id
       WHERE ro.regulation_version_id = rd.current_version_id
       ORDER BY ro.created_at DESC`
    )
    .all() as Array<any>;

  const latestMap = getLatestAssessmentsMapForOrg(orgId);
  const profileState = getCompanyProfile(orgId);

  const items = obligations.map((obl) => {
    const assessment = latestMap.get(obl.id) || null;
    const conditions = extractStructuredConditions(obl);
    const effectiveDecision: ApplicabilityDecision = assessment
      ? assessment.effective_decision
      : 'REQUIRES_REVIEW';

    return {
      obligation: {
        ...obl,
        structuredConditions: conditions,
        evidenceRequired: JSON.parse(obl.evidence_required_json || '[]'),
      },
      assessment,
      effective_decision: effectiveDecision,
      is_stale: assessment ? assessment.is_stale : true,
    };
  });

  const summary = {
    total: items.length,
    applicable: items.filter((i) => i.effective_decision === 'APPLIES').length,
    potentiallyApplicable: items.filter((i) => i.effective_decision === 'POTENTIALLY_APPLIES').length,
    requiresReview: items.filter(
      (i) => i.effective_decision === 'REQUIRES_REVIEW' || (i.assessment?.requires_human_review && i.assessment?.human_review_status === 'PENDING_REVIEW')
    ).length,
    insufficientInformation: items.filter((i) => i.effective_decision === 'INSUFFICIENT_INFORMATION').length,
    notApplicable: items.filter((i) => i.effective_decision === 'DOES_NOT_APPLY').length,
    newApplicableObligations: items.filter(
      (i) => i.effective_decision === 'APPLIES' && ['NEW', 'MODIFIED'].includes(String(i.obligation.change_status))
    ).length,
    staleAssessments: items.filter((i) => i.is_stale).length,
    profileVersion: profileState?.versionNumber || 1,
    profileCompletenessPct: profileState?.completeness.pct || 0,
  };

  return { summary, items };
}
