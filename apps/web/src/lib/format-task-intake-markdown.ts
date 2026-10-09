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

const SOURCE_TYPE_LABELS: Record<string, string> = {
  pasted_email: "Pasted email",
  screenshot: "Screenshot",
  pasted_message: "Pasted message",
  mixed: "Mixed (text + screenshot)",
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "Urgent",
  high: "High",
  medium: "Medium",
  low: "Low",
  "no-priority": "No priority",
};

function buildTaskContextSection(
  draft: GenerateTaskIntakeDraftResponse,
): string | null {
  const lines: string[] = [];

  if (draft.businessName) {
    lines.push(`- **Business:** ${draft.businessName}`);
  }

  if (draft.emailSubject) {
    lines.push(`- **Subject:** ${draft.emailSubject}`);
  }

  if (draft.sourceUrls && draft.sourceUrls.length === 1) {
    lines.push(`- **URL:** ${draft.sourceUrls[0]}`);
  } else if (draft.sourceUrls && draft.sourceUrls.length > 1) {
    const urlLines = draft.sourceUrls.map((url) => `  - ${url}`).join("\n");
    lines.push(`- **URLs:**\n${urlLines}`);
  }

  const sourceLabel =
    SOURCE_TYPE_LABELS[draft.sourceType] ?? draft.sourceType ?? null;
  if (sourceLabel) {
    lines.push(`- **Source:** ${sourceLabel}`);
  }

  if (draft.senderName) {
    lines.push(`- **Sender:** ${draft.senderName}`);
  }

  if (draft.senderEmail) {
    lines.push(`- **Sender email:** ${draft.senderEmail}`);
  }

  if (draft.dueDate) {
    lines.push(`- **Due Date:** ${draft.dueDate}`);
  }

  if (draft.dueDateReason) {
    lines.push(`- **Due Date Reason:** ${draft.dueDateReason}`);
  }

  if (draft.priority && draft.priority !== "no-priority") {
    const priorityLabel = PRIORITY_LABELS[draft.priority] ?? draft.priority;
    lines.push(`- **Priority:** ${priorityLabel}`);
  }

  if (draft.priorityReason) {
    lines.push(`- **Priority Reason:** ${draft.priorityReason}`);
  }

  if (lines.length === 0) return null;
  return lines.join("\n");
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const parts: string[] = [];

  const taskContext = section("Task Context", buildTaskContextSection(draft));
  if (taskContext) parts.push(taskContext);

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
