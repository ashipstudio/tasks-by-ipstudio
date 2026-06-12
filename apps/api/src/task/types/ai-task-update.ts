import type { VALID_PRIORITIES } from "../validate-task-fields";
import type { AiTaskIntakeImageInput } from "./ai-task-intake";

export type AiTaskUpdatePriority = (typeof VALID_PRIORITIES)[number] | null;

export type AiTaskUpdateInput = {
  rawMessage?: string;
  /** Preferred single-image field for Phase 2 (at most one image). */
  image?: AiTaskIntakeImageInput;
  /** Array compat field. Only the first image is used for Phase 2. */
  images?: AiTaskIntakeImageInput[];
};

export type AiTaskUpdateProposal = {
  latestUpdateSummary: string;
  newRequestedChanges: string[];
  changedRequirements: string[];
  supersededRequests: string[];
  suggestedComment: string;
  suggestedDescriptionAppend: string;
  suggestedPriority: AiTaskUpdatePriority;
  suggestedDueDate: string | null;
  missingInfo: string[];
  confidence: number;
};
