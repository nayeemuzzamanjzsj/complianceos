import crypto from 'node:crypto';

export type VersionChangeStatus =
  | 'NEW'
  | 'UNCHANGED'
  | 'MODIFIED'
  | 'REPEALED'
  | 'SUPERSEDED'
  | 'CORRECTED';

export type DiffChangeCategory =
  | 'DEFINITION'
  | 'THRESHOLD'
  | 'REPORTING_DEADLINE'
  | 'RETENTION_PERIOD'
  | 'PENALTY'
  | 'APPLICABILITY_CONDITION'
  | 'REQUIRED_DOCUMENTATION'
  | 'RESPONSIBLE_ENTITY'
  | 'SECURITY_CONTROL'
  | 'GENERAL_PROVISION';

export interface ParsedSection {
  section: string;
  heading: string;
  text: string;
  page?: number;
}

export interface StructuredDiffItem {
  change_type: 'ADDED' | 'REMOVED' | 'MODIFIED';
  section: string;
  category: DiffChangeCategory;
  old_value: string;
  new_value: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  citation: string;
}

export interface DeterministicDiffResult {
  changeStatus: VersionChangeStatus;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  isMaterial: boolean;
  summaryText: string;
  items: StructuredDiffItem[];
  oldSections: ParsedSection[];
  newSections: ParsedSection[];
}

export function normalizeRegulatoryText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function computeContentHash(text: string): string {
  const normalized = normalizeRegulatoryText(text);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

const SECTION_HEADER_RE =
  /^(?:(?:Section|Clause|Article|Part|Rule|Paragraph|Sec\.?|Art\.?)\s+([0-9]+(?:\.[0-9]+)*[a-z]?)\s*[:.\-–]?\s*(.*)|([0-9]+(?:\.[0-9]+)+)\s+([A-Z][^\n]{2,90}))$/i;

export function parseRegulatorySections(rawText: string): ParsedSection[] {
  const normalized = normalizeRegulatoryText(rawText);
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const sections: ParsedSection[] = [];
  let currentSection = '1.0';
  let currentHeading = 'General Provisions';
  let currentPage = 1;
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) {
      sections.push({
        section: currentSection,
        heading: currentHeading,
        text: body,
        page: currentPage,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (buffer.length > 0 && buffer[buffer.length - 1] !== '') {
        buffer.push('');
      }
      continue;
    }

    const pageMatch = trimmed.match(/^---\s*Page\s+(\d+)\s*---$/i);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]) || currentPage;
      continue;
    }

    const headerMatch = trimmed.match(SECTION_HEADER_RE);
    if (headerMatch) {
      flush();
      const num = (headerMatch[1] || headerMatch[3] || String(sections.length + 1)).trim();
      const headingText = (headerMatch[2] || headerMatch[4] || `Section ${num}`).trim();
      currentSection = num;
      // If the header line has inline body after a colon, keep it in buffer too
      const colonIdx = headingText.indexOf(':');
      if (colonIdx > 0 && colonIdx < 60 && headingText.length > colonIdx + 12) {
        currentHeading = headingText.slice(0, colonIdx).trim();
        buffer.push(headingText.slice(colonIdx + 1).trim());
      } else {
        currentHeading = headingText || `Section ${num}`;
      }
      continue;
    }

    buffer.push(trimmed);
  }
  flush();

  if (sections.length === 0) {
    const paragraphs = normalized.split(/\n\n+/).filter(Boolean);
    return paragraphs.map((p, idx) => ({
      section: `${idx + 1}.0`,
      heading: `Clause ${idx + 1}`,
      text: p.trim(),
      page: 1,
    }));
  }

  return sections;
}

export function classifyDiffCategory(text: string): {
  category: DiffChangeCategory;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
} {
  const lower = text.toLowerCase();

  if (/(penalty|penalties|fine|sanction|revocation|civil monetary|administrative fine)/i.test(lower)) {
    return { category: 'PENALTY', severity: 'Critical' };
  }
  if (/(within\s+\d+\s*(hours?|days?|business days?|months?)|deadline|file within|submit within|no later than|rolling\s+\d+-hour)/i.test(lower)) {
    return { category: 'REPORTING_DEADLINE', severity: 'Critical' };
  }
  if (/(retain|retention|archival|archive|preserve for|minimum period of\s+\d+\s*(years?|months?))/i.test(lower)) {
    return { category: 'RETENTION_PERIOD', severity: 'High' };
  }
  if (/(threshold|exceeding|minimum|maximum|limit|bdt|usd|eur|gbp|\d+%|\d{1,3}(?:,\d{3})+)/i.test(lower)) {
    return { category: 'THRESHOLD', severity: 'High' };
  }
  if (/(fido2|hardware mfa|encryption|kms|immutable|tamper-evident|rotation|access control|sovereign|tier-3)/i.test(lower)) {
    return { category: 'SECURITY_CONTROL', severity: 'High' };
  }
  if (/(shall apply to|applies strictly to|applicability|scope|exempt|covered entit|licensed)/i.test(lower)) {
    return { category: 'APPLICABILITY_CONDITION', severity: 'High' };
  }
  if (/(attestation|goaml|xml|dossier|biometric verification log|audit log|return|certificate|supporting document)/i.test(lower)) {
    return { category: 'REQUIRED_DOCUMENTATION', severity: 'Medium' };
  }
  if (/(compliance officer|board|administrator|payment service provider|psp|mfs|reporting entit|controller|operator)/i.test(lower)) {
    return { category: 'RESPONSIBLE_ENTITY', severity: 'Medium' };
  }
  if (/(means|defined as|definition|interpretation of)/i.test(lower)) {
    return { category: 'DEFINITION', severity: 'Medium' };
  }
  return { category: 'GENERAL_PROVISION', severity: 'Medium' };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.;])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function severityRank(sev: 'Critical' | 'High' | 'Medium' | 'Low'): number {
  switch (sev) {
    case 'Critical':
      return 4;
    case 'High':
      return 3;
    case 'Medium':
      return 2;
    default:
      return 1;
  }
}

export function deriveExplicitChangeStatus(params: {
  hasPreviousVersion: boolean;
  sameHash: boolean;
  explicitStatus?: string;
  newTitle?: string;
  newText: string;
}): VersionChangeStatus {
  if (!params.hasPreviousVersion) {
    return 'NEW';
  }
  if (params.sameHash) {
    return 'UNCHANGED';
  }
  const explicit = (params.explicitStatus || '').trim().toUpperCase();
  if (explicit === 'REPEALED' || explicit === 'SUPERSEDED' || explicit === 'CORRECTED') {
    return explicit;
  }
  // Only classify as REPEALED / SUPERSEDED / CORRECTED when explicitly stated in document header/notice
  const headerSample = `${params.newTitle || ''}\n${params.newText.slice(0, 400)}`.toLowerCase();
  if (/\b(hereby repealed|is repealed in its entirety|repeal notice)\b/.test(headerSample)) {
    return 'REPEALED';
  }
  if (/\b(supersedes and replaces|hereby superseded by)\b/.test(headerSample)) {
    return 'SUPERSEDED';
  }
  if (/\b(corrigendum|erratum|typographical correction)\b/.test(headerSample)) {
    return 'CORRECTED';
  }
  return 'MODIFIED';
}

export function computeStructuredRegulatoryDiff(params: {
  previousText: string | null;
  newText: string;
  identifier: string;
  versionNumber: number;
  explicitStatus?: string;
  newTitle?: string;
}): DeterministicDiffResult {
  const newNorm = normalizeRegulatoryText(params.newText);
  const newSections = parseRegulatorySections(newNorm);

  if (!params.previousText) {
    const items: StructuredDiffItem[] = newSections.slice(0, 12).map((sec) => {
      const classified = classifyDiffCategory(`${sec.heading} ${sec.text}`);
      return {
        change_type: 'ADDED',
        section: sec.section,
        category: classified.category,
        old_value: '',
        new_value: sec.text.slice(0, 500),
        severity: classified.severity,
        citation: `${params.identifier} v${params.versionNumber} · Section ${sec.section}`,
      };
    });

    let maxSeverity: 'Critical' | 'High' | 'Medium' | 'Low' = 'Medium';
    for (const item of items) {
      if (severityRank(item.severity) > severityRank(maxSeverity)) {
        maxSeverity = item.severity;
      }
    }

    return {
      changeStatus: deriveExplicitChangeStatus({
        hasPreviousVersion: false,
        sameHash: false,
        explicitStatus: params.explicitStatus,
        newTitle: params.newTitle,
        newText: newNorm,
      }),
      severity: maxSeverity,
      isMaterial: items.length > 0,
      summaryText: `Initial regulatory version (${params.identifier} v${params.versionNumber}) ingested with ${newSections.length} parsed section(s).`,
      items,
      oldSections: [],
      newSections,
    };
  }

  const prevNorm = normalizeRegulatoryText(params.previousText);
  const oldSections = parseRegulatorySections(prevNorm);

  if (computeContentHash(prevNorm) === computeContentHash(newNorm)) {
    return {
      changeStatus: 'UNCHANGED',
      severity: 'Low',
      isMaterial: false,
      summaryText: 'No textual changes detected against previous version.',
      items: [],
      oldSections,
      newSections,
    };
  }

  const items: StructuredDiffItem[] = [];
  const oldMap = new Map<string, ParsedSection>();
  const newMap = new Map<string, ParsedSection>();

  for (const s of oldSections) oldMap.set(s.section.toLowerCase(), s);
  for (const s of newSections) newMap.set(s.section.toLowerCase(), s);

  for (const newSec of newSections) {
    const key = newSec.section.toLowerCase();
    const oldSec = oldMap.get(key);

    if (!oldSec) {
      const classified = classifyDiffCategory(`${newSec.heading} ${newSec.text}`);
      items.push({
        change_type: 'ADDED',
        section: newSec.section,
        category: classified.category,
        old_value: '',
        new_value: newSec.text.slice(0, 600),
        severity: classified.severity,
        citation: `${params.identifier} v${params.versionNumber} · Section ${newSec.section}`,
      });
      continue;
    }

    if (normalizeRegulatoryText(oldSec.text) !== normalizeRegulatoryText(newSec.text)) {
      const oldSentences = splitSentences(oldSec.text);
      const newSentences = splitSentences(newSec.text);
      const oldSet = new Set(oldSentences);
      const newSet = new Set(newSentences);

      const removedSents = oldSentences.filter((s) => !newSet.has(s));
      const addedSents = newSentences.filter((s) => !oldSet.has(s));

      const pairCount = Math.max(removedSents.length, addedSents.length, 1);
      for (let i = 0; i < pairCount; i++) {
        const oldVal = removedSents[i] ?? '';
        const newVal = addedSents[i] ?? '';
        if (!oldVal && !newVal) continue;
        const changeType: 'ADDED' | 'REMOVED' | 'MODIFIED' =
          oldVal && newVal ? 'MODIFIED' : newVal ? 'ADDED' : 'REMOVED';
        const classified = classifyDiffCategory(`${newSec.heading} ${oldVal} ${newVal}`);
        items.push({
          change_type: changeType,
          section: newSec.section,
          category: classified.category,
          old_value: oldVal.slice(0, 600),
          new_value: newVal.slice(0, 600),
          severity: classified.severity,
          citation: `${params.identifier} v${params.versionNumber} · Section ${newSec.section}`,
        });
      }
    }
  }

  for (const oldSec of oldSections) {
    const key = oldSec.section.toLowerCase();
    if (!newMap.has(key)) {
      const classified = classifyDiffCategory(`${oldSec.heading} ${oldSec.text}`);
      items.push({
        change_type: 'REMOVED',
        section: oldSec.section,
        category: classified.category,
        old_value: oldSec.text.slice(0, 600),
        new_value: '',
        severity: classified.severity,
        citation: `${params.identifier} v${params.versionNumber} · Section ${oldSec.section} (removed)`,
      });
    }
  }

  const changeStatus = deriveExplicitChangeStatus({
    hasPreviousVersion: true,
    sameHash: false,
    explicitStatus: params.explicitStatus,
    newTitle: params.newTitle,
    newText: newNorm,
  });

  let maxSeverity: 'Critical' | 'High' | 'Medium' | 'Low' =
    changeStatus === 'REPEALED' || changeStatus === 'SUPERSEDED' ? 'High' : 'Low';
  for (const item of items) {
    if (severityRank(item.severity) > severityRank(maxSeverity)) {
      maxSeverity = item.severity;
    }
  }

  const isMaterial =
    items.some(
      (i) =>
        i.category !== 'GENERAL_PROVISION' ||
        i.change_type !== 'MODIFIED' ||
        severityRank(i.severity) >= 2
    ) || items.length > 0;

  const cats = Array.from(new Set(items.map((i) => i.category.replace(/_/g, ' ').toLowerCase())));
  const summaryText =
    items.length > 0
      ? `Detected ${items.length} structured change(s) (${cats.slice(0, 3).join(', ')}) across ${new Set(items.map((i) => i.section)).size} section(s).`
      : `Regulatory version ${params.versionNumber} updated (${changeStatus}).`;

  return {
    changeStatus,
    severity: maxSeverity,
    isMaterial,
    summaryText,
    items,
    oldSections,
    newSections,
  };
}
