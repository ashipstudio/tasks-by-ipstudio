import type { VALID_PRIORITIES } from "../validate-task-fields";

export const AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AiTaskIntakeImageMimeType =
  (typeof AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES)[number];

export type AiTaskIntakeImageInput = {
  mimeType: AiTaskIntakeImageMimeType;
  data: string;
};

export type AiTaskIntakePriority = (typeof VALID_PRIORITIES)[number];

export type AiTaskIntakeInput = {
  rawMessage?: string;
  image?: AiTaskIntakeImageInput;
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
