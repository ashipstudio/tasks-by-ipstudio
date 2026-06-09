import type { GenerateTaskIntakeDraftResponse } from "@/fetchers/task/generate-task-intake-draft";

function formatBulletList(items: string[]): string {
  if (items.length === 0) {
    return "- None noted";
  }

  return items.map((item) => `- ${item.trim()}`).join("\n");
}

function formatBlockquote(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "> _No original client message provided._";
  }

  return trimmed
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const workerNotes = [
    ...draft.workerNotes,
    ...draft.missingInfo.map((item) => `Missing info: ${item}`),
  ];

  const sections = [
    `## Summary\n\n${draft.summary.trim()}`,
    `## Requested Changes\n\n${formatBulletList(draft.requestedChanges)}`,
    `## Notes for Worker\n\n${formatBulletList(workerNotes)}`,
    `## Original Client Message\n\n${formatBlockquote(draft.originalClientMessage)}`,
  ];

  return sections.join("\n\n");
}
