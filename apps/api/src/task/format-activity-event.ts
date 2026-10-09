/**
 * Describes a task change event in one line for AI prompts.
 * Returns null for event types that carry no useful detail.
 */
export function formatActivityEvent(
  type: string,
  eventData: unknown,
): string | null {
  const data =
    eventData && typeof eventData === "object"
      ? (eventData as Record<string, unknown>)
      : {};

  switch (type) {
    case "status_changed":
      return `status changed from ${data.oldStatus} to ${data.newStatus}`;
    case "priority_changed":
      return `priority changed from ${data.oldPriority} to ${data.newPriority}`;
    case "title_changed":
      return `title changed from "${data.oldTitle}" to "${data.newTitle}"`;
    case "due_date_changed":
      return `due date changed to ${String(data.newDueDate ?? "").slice(0, 10)}`;
    case "assignee_changed":
      return data.newAssignee
        ? `assigned to ${data.newAssignee}`
        : "assignee changed";
    default:
      return null;
  }
}
