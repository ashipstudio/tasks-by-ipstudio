import { useMutation } from "@tanstack/react-query";
import generateTaskAgentPrompt from "@/fetchers/task/generate-task-agent-prompt";

function useGenerateTaskAgentPrompt() {
  return useMutation({
    mutationFn: (taskId: string) => generateTaskAgentPrompt(taskId),
  });
}

export default useGenerateTaskAgentPrompt;
