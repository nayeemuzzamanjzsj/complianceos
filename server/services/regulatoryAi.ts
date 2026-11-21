import { GoogleGenAI, Type } from '@google/genai';
import type { ParsedSection, StructuredDiffItem } from './regulatoryDiff.ts';

export const ALLOWED_OBLIGATION_TYPES = [
  'REPORT',
  'DISCLOSE',
  'RETAIN',
  'MONITOR',
  'NOTIFY',
  'OBTAIN_APPROVAL',
  'IMPLEMENT_CONTROL',
  'MAINTAIN_RECORD',
  'CONDUCT_ASSESSMENT',
  'FILE_RETURN',
  'PROTECT_DATA',
] as const;

export type ObligationType = (typeof ALLOWED_OBLIGATION_TYPES)[number];

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
  confidence: 'High' | 'Medium' | 'Low';
  insufficient_evidence: boolean;
  ai_generated: boolean;
  model_name?: string;
}

export interface ExtractedObligationInput {
  title: string;
  description: string;
  obligation_type: ObligationType;
  applicability_conditions: {
    country?: string;
    state_province?: string;
    industries?: string[];
    company_types?: string[];
    organization_size?: string;
    business_activities?: string[];
    thresholds?: string[];
    regulated_products?: string[];
  };
  required_action: string;
  deadline: string;
  frequency: string;
  responsible_entity: string;
  evidence_required: string[];
  source_reference: string;
  confidence: 'High' | 'Medium' | 'Low';
  extraction_method: 'gemini_ai' | 'deterministic';
}

export class AiSchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiSchemaValidationError';
  }
}

export interface RegulatoryAiProvider {
  readonly providerName: string;
  isConfigured(): boolean;
  interpretChange(params: {
    identifier: string;
    title: string;
    regulator: string;
    jurisdiction: string;
    versionNumber: number;
    diffItems: StructuredDiffItem[];
    boundedExcerpt: string;
  }): Promise<SemanticChangeSummary>;
  extractObligations(params: {
    identifier: string;
    title: string;
    regulator: string;
    jurisdiction: string;
    versionNumber: number;
    sections: ParsedSection[];
    diffItems: StructuredDiffItem[];
  }): Promise<ExtractedObligationInput[]>;
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function validateSemanticChangeSummary(raw: unknown): SemanticChangeSummary {
  if (!raw || typeof raw !== 'object') {
    throw new AiSchemaValidationError('Semantic change output must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  const meaning = typeof obj.meaning === 'string' ? obj.meaning.trim() : '';
  const potentialImpact = typeof obj.potential_impact === 'string' ? obj.potential_impact.trim() : '';

  if (!summary) {
    throw new AiSchemaValidationError('Semantic change output missing required summary.');
  }

  const insufficient =
    obj.insufficient_evidence === true || summary === 'INSUFFICIENT_SOURCE_EVIDENCE';

  const citationsRaw = Array.isArray(obj.citations) ? obj.citations : [];
  const citations = citationsRaw
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c) => ({
      version: String(c.version || '').trim(),
      section: String(c.section || '').trim(),
      excerpt: String(c.excerpt || '').trim(),
    }))
    .filter((c) => c.section.length > 0 && c.excerpt.length > 0);

  if (!insufficient && citations.length === 0) {
    throw new AiSchemaValidationError('Unsupported AI output rejected: citations are required unless INSUFFICIENT_SOURCE_EVIDENCE.');
  }

  const conf = String(obj.confidence || 'Medium');
  const confidence: 'High' | 'Medium' | 'Low' =
    conf === 'High' || conf === 'Low' ? conf : 'Medium';

  const toStringArr = (val: unknown): string[] =>
    Array.isArray(val) ? val.map((v) => String(v).trim()).filter(Boolean) : [];

  return {
    summary: insufficient ? 'INSUFFICIENT_SOURCE_EVIDENCE' : summary,
    meaning: meaning || summary,
    is_obligation_change: Boolean(obj.is_obligation_change),
    affected_entities: toStringArr(obj.affected_entities),
    changed_deadlines: toStringArr(obj.changed_deadlines),
    changed_thresholds: toStringArr(obj.changed_thresholds),
    operational_changes: toStringArr(obj.operational_changes),
    material_changes: toStringArr(obj.material_changes),
    affected_obligation_types: toStringArr(obj.affected_obligation_types),
    potential_impact: potentialImpact || meaning || summary,
    recommended_review: toStringArr(obj.recommended_review),
    citations,
    confidence,
    insufficient_evidence: insufficient,
    ai_generated: true,
    model_name: 'gemini-4-hydrogen',
  };
}

export function validateExtractedObligations(raw: unknown): ExtractedObligationInput[] {
  if (!raw || typeof raw !== 'object') {
    throw new AiSchemaValidationError('Obligation extraction output must be a JSON object.');
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.obligations)) {
    throw new AiSchemaValidationError('Obligation extraction output must include an obligations array.');
  }

  const validated: ExtractedObligationInput[] = [];
  for (const item of obj.obligations) {
    if (!item || typeof item !== 'object') {
      throw new AiSchemaValidationError('Each extracted obligation must be an object.');
    }
    const r = item as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    const oblType = String(r.obligation_type || '').trim().toUpperCase();
    const requiredAction = typeof r.required_action === 'string' ? r.required_action.trim() : '';
    const sourceRef = typeof r.source_reference === 'string' ? r.source_reference.trim() : '';

    if (!title || !description || !requiredAction || !sourceRef) {
      throw new AiSchemaValidationError('Extracted obligation missing required title, description, required_action, or source_reference.');
    }
    if (!ALLOWED_OBLIGATION_TYPES.includes(oblType as ObligationType)) {
      throw new AiSchemaValidationError(`Unsupported obligation_type "${oblType}".`);
    }

    const condRaw = (r.applicability_conditions && typeof r.applicability_conditions === 'object'
      ? r.applicability_conditions
      : {}) as Record<string, unknown>;
    const toStrList = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
    const conf = String(r.confidence || 'Medium');

    validated.push({
      title,
      description,
      obligation_type: oblType as ObligationType,
      applicability_conditions: {
        country: typeof condRaw.country === 'string' ? condRaw.country.trim() : undefined,
        state_province:
          typeof condRaw.state_province === 'string' ? condRaw.state_province.trim() : undefined,
        industries: toStrList(condRaw.industries),
        company_types: toStrList(condRaw.company_types),
        organization_size:
          typeof condRaw.organization_size === 'string' ? condRaw.organization_size.trim() : undefined,
        business_activities: toStrList(condRaw.business_activities),
        thresholds: toStrList(condRaw.thresholds),
        regulated_products: toStrList(condRaw.regulated_products),
      },
      required_action: requiredAction,
      deadline: typeof r.deadline === 'string' && r.deadline.trim() ? r.deadline.trim() : 'Upon effective date',
      frequency: typeof r.frequency === 'string' && r.frequency.trim() ? r.frequency.trim() : 'Ongoing',
      responsible_entity:
        typeof r.responsible_entity === 'string' && r.responsible_entity.trim()
          ? r.responsible_entity.trim()
          : 'Regulated Entity Compliance Function',
      evidence_required: toStrList(r.evidence_required),
      source_reference: sourceRef,
      confidence: conf === 'High' || conf === 'Low' ? conf : 'Medium',
      extraction_method: 'gemini_ai',
    });
  }

  return validated;
}

class GeminiRegulatoryAiProvider implements RegulatoryAiProvider {
  readonly providerName = 'gemini-4-hydrogen';

  isConfigured(): boolean {
    return getGeminiClient() !== null;
  }

  async interpretChange(params: {
    identifier: string;
    title: string;
    regulator: string;
    jurisdiction: string;
    versionNumber: number;
    diffItems: StructuredDiffItem[];
    boundedExcerpt: string;
  }): Promise<SemanticChangeSummary> {
    const ai = getGeminiClient();
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    if (params.diffItems.length === 0 && !params.boundedExcerpt.trim()) {
      return {
        summary: 'INSUFFICIENT_SOURCE_EVIDENCE',
        meaning: 'INSUFFICIENT_SOURCE_EVIDENCE',
        is_obligation_change: false,
        affected_entities: [],
        changed_deadlines: [],
        changed_thresholds: [],
        operational_changes: [],
        material_changes: [],
        affected_obligation_types: [],
        potential_impact: 'INSUFFICIENT_SOURCE_EVIDENCE',
        recommended_review: [],
        citations: [],
        confidence: 'Low',
        insufficient_evidence: true,
        ai_generated: true,
        model_name: this.providerName,
      };
    }

    const prompt = `You are a regulatory intelligence analyst. Interpret ONLY the verified deterministic diff and bounded regulatory excerpt below.
Never fabricate regulatory facts, deadlines, thresholds, or sections.
If the provided text/diff lacks enough factual evidence to interpret the change safely, set insufficient_evidence=true and summary="INSUFFICIENT_SOURCE_EVIDENCE".

REGULATION: ${params.identifier} — ${params.title}
REGULATOR: ${params.regulator} (${params.jurisdiction})
VERSION: v${params.versionNumber}

DETERMINISTIC DIFF ITEMS:
${JSON.stringify(params.diffItems.slice(0, 15), null, 2)}

BOUNDED SOURCE EXCERPT:
${params.boundedExcerpt.slice(0, 6000)}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Analyze the deterministic regulatory diff. Cite exact version and section numbers from the source. Never invent obligations or dates.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            meaning: { type: Type.STRING },
            is_obligation_change: { type: Type.BOOLEAN },
            affected_entities: { type: Type.ARRAY, items: { type: Type.STRING } },
            changed_deadlines: { type: Type.ARRAY, items: { type: Type.STRING } },
            changed_thresholds: { type: Type.ARRAY, items: { type: Type.STRING } },
            operational_changes: { type: Type.ARRAY, items: { type: Type.STRING } },
            material_changes: { type: Type.ARRAY, items: { type: Type.STRING } },
            affected_obligation_types: { type: Type.ARRAY, items: { type: Type.STRING } },
            potential_impact: { type: Type.STRING },
            recommended_review: { type: Type.ARRAY, items: { type: Type.STRING } },
            insufficient_evidence: { type: Type.BOOLEAN },
            confidence: { type: Type.STRING },
            citations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  version: { type: Type.STRING },
                  section: { type: Type.STRING },
                  excerpt: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return validateSemanticChangeSummary(parsed);
  }

  async extractObligations(params: {
    identifier: string;
    title: string;
    regulator: string;
    jurisdiction: string;
    versionNumber: number;
    sections: ParsedSection[];
    diffItems: StructuredDiffItem[];
  }): Promise<ExtractedObligationInput[]> {
    const ai = getGeminiClient();
    if (!ai) {
      throw new Error('GEMINI_API_KEY is not configured.');
    }

    const boundedSections = params.sections
      .slice(0, 8)
      .map((s) => `[Section ${s.section} - ${s.heading}]: ${s.text.slice(0, 900)}`)
      .join('\n\n');

    const prompt = `Extract structured regulatory obligations strictly grounded in the regulatory text and diff items below.
Allowed obligation_type values ONLY: ${ALLOWED_OBLIGATION_TYPES.join(', ')}.
Every obligation MUST cite its exact section in source_reference (e.g., "${params.identifier} v${params.versionNumber} Section 4.2").

REGULATION: ${params.identifier} — ${params.title}
REGULATOR: ${params.regulator}
JURISDICTION: ${params.jurisdiction}

DIFF ITEMS:
${JSON.stringify(params.diffItems.slice(0, 10))}

SECTIONS:
${boundedSections}
`;

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'Convert regulatory requirements into structured obligation records using only the allowed obligation_type enum values. Never invent rules not present in the text.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            obligations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  obligation_type: { type: Type.STRING },
                  applicability_conditions: {
                    type: Type.OBJECT,
                    properties: {
                      country: { type: Type.STRING },
                      state_province: { type: Type.STRING },
                      industries: { type: Type.ARRAY, items: { type: Type.STRING } },
                      company_types: { type: Type.ARRAY, items: { type: Type.STRING } },
                      thresholds: { type: Type.ARRAY, items: { type: Type.STRING } },
                      regulated_products: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                  },
                  required_action: { type: Type.STRING },
                  deadline: { type: Type.STRING },
                  frequency: { type: Type.STRING },
                  responsible_entity: { type: Type.STRING },
                  evidence_required: { type: Type.ARRAY, items: { type: Type.STRING } },
                  source_reference: { type: Type.STRING },
                  confidence: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    return validateExtractedObligations(parsed);
  }
}

export const regulatoryAiProvider: RegulatoryAiProvider = new GeminiRegulatoryAiProvider();

export function extractDeterministicObligations(params: {
  identifier: string;
  jurisdiction: string;
  regulator: string;
  versionNumber: number;
  sections: ParsedSection[];
  diffItems: StructuredDiffItem[];
}): ExtractedObligationInput[] {
  const results: ExtractedObligationInput[] = [];
  const sourceItems =
    params.diffItems.length > 0
      ? params.diffItems.filter((d) => d.change_type !== 'REMOVED')
      : params.sections.map((s) => ({
          change_type: 'ADDED' as const,
          section: s.section,
          category: 'GENERAL_PROVISION' as const,
          old_value: '',
          new_value: s.text,
          severity: 'Medium' as const,
          citation: `${params.identifier} v${params.versionNumber} · Section ${s.section}`,
        }));

  for (const item of sourceItems.slice(0, 6)) {
    const text = item.new_value || '';
    if (text.trim().length < 20) continue;
    const lower = text.toLowerCase();

    let oblType: ObligationType = 'IMPLEMENT_CONTROL';
    if (/(retain|retention|archive|years|storage)/i.test(lower)) oblType = 'RETAIN';
    else if (/(report|submit|str|goaml|xml)/i.test(lower)) oblType = 'REPORT';
    else if (/(notify|notification|breach)/i.test(lower)) oblType = 'NOTIFY';
    else if (/(disclose|disclosure)/i.test(lower)) oblType = 'DISCLOSE';
    else if (/(monitor|detect|screening|window)/i.test(lower)) oblType = 'MONITOR';
    else if (/(approval|authorize|consent)/i.test(lower)) oblType = 'OBTAIN_APPROVAL';
    else if (/(audit|assessment|review)/i.test(lower)) oblType = 'CONDUCT_ASSESSMENT';
    else if (/(return|filing)/i.test(lower)) oblType = 'FILE_RETURN';
    else if (/(encrypt|kms|pii|biometric|protect)/i.test(lower)) oblType = 'PROTECT_DATA';
    else if (/(log|record|dossier|attestation)/i.test(lower)) oblType = 'MAINTAIN_RECORD';

    const deadlineMatch = text.match(/(within\s+\d+\s*(?:hours?|days?|months?)|quarterly|annual|by\s+\d{4}-\d{2}-\d{2})/i);
    results.push({
      title: `${oblType.replace(/_/g, ' ')} requirement (${params.identifier} Sec. ${item.section})`,
      description: text.slice(0, 320),
      obligation_type: oblType,
      applicability_conditions: {
        country: params.jurisdiction,
      },
      required_action: text.slice(0, 260),
      deadline: deadlineMatch ? deadlineMatch[1] : 'Effective date compliance',
      frequency: /quarterly/i.test(lower) ? 'Quarterly' : /annual/i.test(lower) ? 'Annual' : 'Continuous',
      responsible_entity: 'Regulated Entities in Scope',
      evidence_required: ['Configuration or policy proof', 'Verification audit record'],
      source_reference: `${params.identifier} v${params.versionNumber} · Section ${item.section}`,
      confidence: 'Medium',
      extraction_method: 'deterministic',
    });
  }

  return results;
}
