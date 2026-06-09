import type { GenerateTaskIntakeDraftResponse } from "@/fetchers/task/generate-task-intake-draft";

function formatBulletList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const sections = [
    `## Summary\n\n${draft.summary}`,
    `## Requested Changes\n\n${formatBulletList(draft.requestedChanges)}`,
    `## Notes for Worker\n\n${formatBulletList(draft.workerNotes)}`,
  ];

  if (draft.missingInfo.length > 0) {
    sections.push(`## Missing Info\n\n${formatBulletList(draft.missingInfo)}`);
  }

  sections.push(`## Original Client Message\n\n${draft.originalClientMessage}`);

  return sections.join("\n\n");
}
