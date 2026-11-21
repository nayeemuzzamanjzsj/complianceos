import { GoogleGenAI, Type } from '@google/genai';
import { db } from '../db.ts';

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

export function retrieveRelevantDocumentChunks(organizationId: string, queryText: string, limit = 5) {
  const tokens = queryText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const rows = db
    .prepare(
      `SELECT dc.id, dc.document_id, dc.content, dc.keywords, d.filename, d.classification
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       WHERE dc.organization_id = ?`
    )
    .all(organizationId) as Array<{
    id: string;
    document_id: string;
    content: string;
    keywords: string;
    filename: string;
    classification: string;
  }>;

  const scored = rows.map((row) => {
    const haystack = `${row.content} ${row.keywords} ${row.filename}`.toLowerCase();
    let score = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1;
    }
    return { ...row, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function runAiApplicabilityAnalysis(params: {
  organizationId: string;
  organization: Record<string, unknown>;
  profile: Record<string, unknown>;
  regulation: {
    id: string;
    code: string;
    title: string;
    regulator: string;
    jurisdiction: string;
    effective_date: string;
    source_url: string;
  };
  latestVersion: {
    raw_text: string;
    diff_previous_text: string;
    diff_new_text: string;
  };
}) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('AI service is not configured. Configure GEMINI_API_KEY in Settings -> Secrets to run live Gemini applicability analysis.');
  }

  const chunks = retrieveRelevantDocumentChunks(
    params.organizationId,
    `${params.regulation.title} ${params.latestVersion.diff_new_text}`,
    4
  );

  const prompt = `You are a regulatory compliance analyst providing decision support (not legal advice).
Analyze whether the following regulatory change applies to the organization based strictly on the provided company profile facts, regulatory text, and internal document excerpts. Never fabricate regulatory facts or citations.

COMPANY OVERVIEW:
${JSON.stringify(params.organization)}

COMPANY PROFILE:
${JSON.stringify(params.profile)}

REGULATION:
Code: ${params.regulation.code}
Title: ${params.regulation.title}
Regulator: ${params.regulation.regulator}
Jurisdiction: ${params.regulation.jurisdiction}
Effective Date: ${params.regulation.effective_date}
Source URL: ${params.regulation.source_url}

PREVIOUS TEXT:
${params.latestVersion.diff_previous_text}

NEW TEXT:
${params.latestVersion.diff_new_text}

FULL REGULATORY CONTEXT:
${params.latestVersion.raw_text}

INTERNAL DOCUMENT EXCERPTS:
${chunks.map((c) => `[${c.filename} - ${c.classification}]: ${c.content}`).join('\n')}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Return grounded, structured JSON applicability reasoning citing specific profile facts and regulatory clauses. Distinguish authoritative text from AI interpretation.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          verdict: {
            type: Type.STRING,
            description: 'One of: Applicable, Partially Applicable, Not Applicable',
          },
          confidence: {
            type: Type.STRING,
            description: 'One of: High, Medium, Low',
          },
          summary: {
            type: Type.STRING,
            description: 'Concise 2-sentence factual summary of applicability.',
          },
          profileReasons: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fact: { type: Type.STRING },
                matched: { type: Type.BOOLEAN },
                explanation: { type: Type.STRING },
              },
            },
          },
          citations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                source: { type: Type.STRING },
                clause: { type: Type.STRING },
                excerpt: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim());
  return parsed;
}

export async function runAiActionPlanGeneration(params: {
  organizationId: string;
  regulation: {
    code: string;
    title: string;
    regulator: string;
    effective_date: string;
  };
  diffNewText: string;
  existingControls: Array<{ id: string; code: string; title: string }>;
  existingPolicies: Array<{ id: string; title: string; current_text: string }>;
}) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('AI service is not configured. Configure GEMINI_API_KEY in Settings -> Secrets to generate live Gemini action plans.');
  }

  const prompt = `Generate a concrete compliance remediation action plan for this regulatory change.
Regulation: ${params.regulation.code} - ${params.regulation.title} (${params.regulation.regulator}, effective ${params.regulation.effective_date})
New Requirement Text: ${params.diffNewText}
Existing Controls: ${JSON.stringify(params.existingControls)}
Existing Policies: ${JSON.stringify(params.existingPolicies.map((p) => ({ id: p.id, title: p.title })))}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Produce specific, actionable remediation tasks mapped to concrete required evidence and realistic owners (Compliance, Engineering, Security, Operations).',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          actions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                requiredChange: { type: Type.STRING },
                ownerDepartment: { type: Type.STRING },
                priority: { type: Type.STRING },
                deadlineDays: { type: Type.INTEGER },
                requiredEvidence: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                sourceCitation: { type: Type.STRING },
                confidence: { type: Type.STRING },
              },
            },
          },
        },
      },
    },
  });

  return JSON.parse((response.text ?? '{}').trim());
}

export async function runAiEvidenceEvaluation(params: {
  requirementTitle: string;
  controlTitle: string;
  requiredChange: string;
  evidenceTitle: string;
  evidenceType: string;
  evidenceContent: string;
}) {
  const ai = getGeminiClient();
  if (!ai) {
    throw new Error('AI service is not configured. Configure GEMINI_API_KEY in Settings -> Secrets to run automated evidence evaluation.');
  }

  const prompt = `Evaluate whether the uploaded compliance evidence satisfies the regulatory requirement and control.
Notice: ComplianceOS provides compliance decision support only, not legal certification. Human reviewer sign-off is mandatory.

Requirement / Remediation: ${params.requirementTitle}
Control: ${params.controlTitle}
Required Change: ${params.requiredChange}
Evidence Title: ${params.evidenceTitle}
Evidence Type: ${params.evidenceType}
Evidence Extracted Content:
${params.evidenceContent.slice(0, 6000)}
`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Compare evidence strictly against the stated requirement. Do not assume unstated facts. Indicate gaps clearly if present.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          recommendation: {
            type: Type.STRING,
            description: 'One of: PASS_RECOMMENDED, GAPS_FOUND, INSUFFICIENT_EVIDENCE',
          },
          confidence: { type: Type.STRING },
          summary: { type: Type.STRING },
          matchedCriteria: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          gapsOrNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          disclaimer: { type: Type.STRING },
        },
      },
    },
  });

  return JSON.parse((response.text ?? '{}').trim());
}

export async function runAiDocumentSummary(filename: string, classification: string, textContent: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) return null;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Summarize this compliance document in 2 crisp sentences for an internal compliance repository.\nFilename: ${filename}\nClassification: ${classification}\nContent:\n${textContent.slice(0, 5000)}`,
    });
    return response.text?.trim() || null;
  } catch {
    return null;
  }
}
