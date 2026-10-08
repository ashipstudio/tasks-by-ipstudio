import { client } from "@kaneo/libs";
import type { InferResponseType } from "hono/client";

export type GenerateTaskAgentPromptResponse = InferResponseType<
  (typeof client)["task"]["agent-prompt"][":taskId"]["$post"],
  200
>;

async function generateTaskAgentPrompt(
  taskId: string,
): Promise<GenerateTaskAgentPromptResponse> {
  const response = await client.task["agent-prompt"][":taskId"].$post({
    param: { taskId },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default generateTaskAgentPrompt;
