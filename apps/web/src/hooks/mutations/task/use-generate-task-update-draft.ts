import { useMutation } from "@tanstack/react-query";
import generateTaskUpdateDraft, {
  type GenerateTaskUpdateDraftRequest,
} from "@/fetchers/task/generate-task-update-draft";

function useGenerateTaskUpdateDraft() {
  return useMutation({
    mutationFn: (input: GenerateTaskUpdateDraftRequest) =>
      generateTaskUpdateDraft(input),
  });
}

export default useGenerateTaskUpdateDraft;
