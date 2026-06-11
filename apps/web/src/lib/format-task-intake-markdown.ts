import type { GenerateTaskIntakeDraftResponse } from "@/fetchers/task/generate-task-intake-draft";

type MessageSegment =
  | { type: "prose"; content: string }
  | { type: "code"; content: string; language?: string };

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function collapseExtraBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function inferCodeLanguage(code: string): string {
  const sample = code.toLowerCase();

  if (
    sample.includes("<script") ||
    sample.includes("<!doctype") ||
    sample.includes("<html") ||
    sample.includes("</div>")
  ) {
    return "html";
  }

  if (sample.includes("<?php")) {
    return "php";
  }

  if (sample.includes("{") && sample.includes(":") && !sample.includes("<")) {
    return "css";
  }

  const trimmed = code.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }

  if (
    sample.includes("function ") ||
    sample.includes("const ") ||
    sample.includes("=>") ||
    sample.includes("console.")
  ) {
    return "javascript";
  }

  return "";
}

function wrapCodeBlock(code: string, language?: string): string {
  const lang = language ?? inferCodeLanguage(code);
  const trimmed = code.replace(/^\n+|\n+$/g, "");
  return `\`\`\`${lang}\n${trimmed}\n\`\`\``;
}

function formatBlockquote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function parseFencedMarkdown(text: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const fenceRegex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match = fenceRegex.exec(text);

  while (match) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: "prose", content: before });
    }

    segments.push({
      type: "code",
      content: match[2],
      language: match[1] || undefined,
    });

    lastIndex = match.index + match[0].length;
    match = fenceRegex.exec(text);
  }

  const after = text.slice(lastIndex);
  if (after.trim()) {
    segments.push({ type: "prose", content: after });
  }

  return segments;
}

function extractCodeBlocksFromMessage(text: string): MessageSegment[] {
  const normalized = normalizeNewlines(text).trim();
  if (!normalized) {
    return [];
  }

  if (normalized.includes("```")) {
    return parseFencedMarkdown(normalized);
  }

  const codePatterns: Array<{ pattern: RegExp; language: string }> = [
    { pattern: /<script[\s\S]*?<\/script>/gi, language: "html" },
    { pattern: /<style[\s\S]*?<\/style>/gi, language: "css" },
  ];

  type CodeMatch = {
    start: number;
    end: number;
    content: string;
    language: string;
  };

  const matches: CodeMatch[] = [];

  for (const { pattern, language } of codePatterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(normalized);

    while (match) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        content: match[0],
        language,
      });
      match = pattern.exec(normalized);
    }
  }

  matches.sort((a, b) => a.start - b.start);

  const nonOverlapping: CodeMatch[] = [];
  for (const match of matches) {
    const last = nonOverlapping.at(-1);
    if (last && match.start < last.end) {
      continue;
    }
    nonOverlapping.push(match);
  }

  const segments: MessageSegment[] = [];
  let cursor = 0;

  for (const match of nonOverlapping) {
    if (match.start > cursor) {
      const prose = normalized.slice(cursor, match.start);
      if (prose.trim()) {
        segments.push({ type: "prose", content: prose });
      }
    }

    segments.push({
      type: "code",
      content: match.content,
      language: match.language,
    });
    cursor = match.end;
  }

  if (cursor < normalized.length) {
    const prose = normalized.slice(cursor);
    if (prose.trim()) {
      segments.push({ type: "prose", content: prose });
    }
  }

  if (segments.length === 0) {
    segments.push({ type: "prose", content: normalized });
  }

  return segments;
}

function formatOriginalClientMessage(text: string): string {
  const segments = extractCodeBlocksFromMessage(text);

  if (segments.length === 0) {
    return "> _No original client message provided._";
  }

  return segments
    .map((segment) => {
      if (segment.type === "code") {
        return wrapCodeBlock(segment.content, segment.language);
      }

      return formatBlockquote(segment.content);
    })
    .filter((segment) => segment.trim())
    .join("\n\n");
}

function formatSectionBody(body: string): string {
  const trimmed = normalizeNewlines(body).trim();
  if (!trimmed) {
    return "";
  }

  if (/^[-*+] /m.test(trimmed) || /^\d+\. /m.test(trimmed)) {
    return trimmed;
  }

  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length > 1) {
    return paragraphs.join("\n\n");
  }

  return trimmed;
}

function formatBulletList(items: string[]): string | null {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  if (filtered.length === 0) {
    return null;
  }

  return filtered.map((item) => `- ${item}`).join("\n");
}

function formatNotesForWorker(
  workerNotes: string[],
  missingInfo: string[],
): string {
  const parts: string[] = [];
  const notes = formatBulletList(workerNotes);

  if (notes) {
    parts.push(notes);
  }

  if (missingInfo.length > 0) {
    const missing = formatBulletList(missingInfo);
    if (missing) {
      parts.push(`### Missing Info\n\n${missing}`);
    }
  }

  if (parts.length === 0) {
    return "- None noted";
  }

  return parts.join("\n\n");
}

function formatSection(heading: string, body: string | null): string | null {
  if (!body?.trim()) {
    return null;
  }

  return `## ${heading}\n\n${body.trim()}`;
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const sections: string[] = [];

  const summary = formatSection("Summary", formatSectionBody(draft.summary));
  if (summary) {
    sections.push(summary);
  }

  const requestedChanges = formatBulletList(draft.requestedChanges);
  const changesSection = formatSection("Requested Changes", requestedChanges);
  if (changesSection) {
    sections.push(changesSection);
  }

  const notesSection = formatSection(
    "Notes for Worker",
    formatNotesForWorker(draft.workerNotes, draft.missingInfo),
  );
  if (notesSection) {
    sections.push(notesSection);
  }

  const originalSection = formatSection(
    "Original Client Message",
    formatOriginalClientMessage(draft.originalClientMessage),
  );
  if (originalSection) {
    sections.push(originalSection);
  }

  return collapseExtraBlankLines(sections.join("\n\n"));
}
