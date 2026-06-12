import { useMutation } from "@tanstack/react-query";
import generateTaskIntakeDraft, {
  type GenerateTaskIntakeDraftRequest,
} from "@/fetchers/task/generate-task-intake-draft";

function useGenerateTaskIntakeDraft() {
  return useMutation({
    mutationFn: (input: GenerateTaskIntakeDraftRequest) =>
      generateTaskIntakeDraft(input),
  });
}

export default useGenerateTaskIntakeDraft;
