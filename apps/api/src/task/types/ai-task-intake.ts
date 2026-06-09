import type { VALID_PRIORITIES } from "../validate-task-fields";

export type AiTaskIntakePriority = (typeof VALID_PRIORITIES)[number];

export type AiTaskIntakeInput = {
  rawMessage: string;
  projectName?: string;
  workspaceName?: string;
  existingLabels?: string[];
};

export type AiTaskIntakeResult = {
  title: string;
  businessName: string | null;
  summary: string;
  requestedChanges: string[];
  workerNotes: string[];
  originalClientMessage: string;
  priority: AiTaskIntakePriority;
  dueDate: string | null;
  labels: string[];
  missingInfo: string[];
  confidence: number;
};
