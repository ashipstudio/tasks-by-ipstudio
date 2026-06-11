import type { GenerateTaskIntakeDraftResponse } from "@/fetchers/task/generate-task-intake-draft";

/**
 * Wraps text in a fenced code block with `text` language tag.
 *
 * This is safer than blockquoting for raw client messages because the content
 * may contain HTML, scripts, shortcodes, Liquid, JSON, markdown fences, or
 * other syntax that would break TipTap rendering if left in a blockquote.
 * A fenced code block treats everything inside as literal text.
 */
function fencedText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  // If the content itself contains a closing fence, escape it by lengthening
  // the opening/closing fence so it never matches mid-content.
  const backtickRuns = [...trimmed.matchAll(/`+/g)].map((m) => m[0].length);
  const maxRun = backtickRuns.length > 0 ? Math.max(...backtickRuns) : 0;
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  return `${fence}text\n${trimmed}\n${fence}`;
}

/**
 * Formats a list of bullet items into a markdown list.
 *
 * Items may contain embedded fenced code blocks (multi-line strings from
 * Gemini). We split at the first newline so the "- " prefix only applies to
 * the opening line, and the rest of the content (e.g. a ``` block) sits at
 * block level separated by a blank line — which TipTap requires to render a
 * code fence correctly.
 */
function bulletList(items: string[]): string | null {
  const filtered = items.map((item) => item.trim()).filter(Boolean);
  if (filtered.length === 0) return null;

  return filtered
    .map((item) => {
      const newlineIdx = item.indexOf("\n");
      if (newlineIdx === -1) return `- ${item}`;
      const firstLine = item.slice(0, newlineIdx);
      const rest = item.slice(newlineIdx + 1).trim();
      return rest ? `- ${firstLine}\n\n${rest}` : `- ${firstLine}`;
    })
    .join("\n\n");
}

function section(heading: string, body: string | null): string | null {
  if (!body?.trim()) return null;
  return `## ${heading}\n\n${body.trim()}`;
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const parts: string[] = [];

  const summary = section("Summary", draft.summary.trim() || null);
  if (summary) parts.push(summary);

  const requestedChanges = section(
    "Requested Changes",
    bulletList(draft.requestedChanges),
  );
  if (requestedChanges) parts.push(requestedChanges);

  const allNotes = [
    ...draft.workerNotes,
    ...draft.missingInfo.map((item) => `**Missing info:** ${item}`),
  ];
  const notes = section("Notes for Worker", bulletList(allNotes));
  if (notes) parts.push(notes);

  // Wrap the original message in a fenced text block — no parsing, no
  // transformation. A fenced block is the only format that guarantees raw
  // HTML, scripts, shortcodes, markdown fences, and other client syntax
  // cannot break the surrounding TipTap sections.
  const fenced = fencedText(draft.originalClientMessage);
  const original = section("Original Client Message", fenced || null);
  if (original) parts.push(original);

  return parts.join("\n\n");
}
