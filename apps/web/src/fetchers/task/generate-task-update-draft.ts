import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

export type GenerateTaskUpdateDraftRequest = InferRequestType<
  (typeof client)["task"]["update-draft"][":taskId"]["$post"]
>["json"] &
  InferRequestType<
    (typeof client)["task"]["update-draft"][":taskId"]["$post"]
  >["param"];

export type GenerateTaskUpdateDraftResponse = InferResponseType<
  (typeof client)["task"]["update-draft"][":taskId"]["$post"],
  200
>;

async function generateTaskUpdateDraft({
  taskId,
  rawMessage,
  images,
  image,
}: GenerateTaskUpdateDraftRequest): Promise<GenerateTaskUpdateDraftResponse> {
  const response = await client.task["update-draft"][":taskId"].$post({
    param: { taskId },
    json: {
      ...(rawMessage ? { rawMessage } : {}),
      ...(images && images.length > 0 ? { images } : {}),
      ...(image ? { image } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default generateTaskUpdateDraft;
