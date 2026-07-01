const QUESTION_SECTION =
  /\b(question|questions|follow[- ]?ups?|unresolved|unclear|open issues?|next steps?)\b/i;
const EXPLICIT_PREFIX =
  /^(?:q(?:uestion)?\s*\d*|follow[- ]?up|unresolved|open question|todo)\s*[:.)-]\s*/i;

function cleanCandidate(value: string): string {
  return value
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(EXPLICIT_PREFIX, "")
    .replace(/\s*\?\?\s*$/, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[?.!,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractQuestionsFromMarkdown(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, "");
  const lines = withoutCode.split(/\r?\n/);
  const candidates: string[] = [];
  let inQuestionSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#{1,6}\s+/.test(line)) {
      inQuestionSection = QUESTION_SECTION.test(line);
      continue;
    }

    const listItem = /^(?:[-*+]|\d+[.)])\s+/.test(line);
    const explicit = EXPLICIT_PREFIX.test(
      line.replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, ""),
    );
    const marked = line.includes("??");
    const cleaned = cleanCandidate(line);
    if (cleaned.length < 6 || /^https?:\/\//i.test(cleaned)) continue;

    if (
      explicit ||
      marked ||
      cleaned.endsWith("?") ||
      (inQuestionSection && listItem)
    ) {
      candidates.push(cleaned);
      continue;
    }

    for (const match of cleaned.matchAll(/(?:^|[.!]\s+)([^?\n]{6,}\?)/g)) {
      candidates.push(match[1].trim());
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export function extractedQuestionFingerprint(
  messageId: string,
  markdown: string,
): string {
  const value = `${messageId}:${candidateKey(markdown)}`;
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gpt-question:${messageId}:${(hash >>> 0).toString(16)}`;
}
