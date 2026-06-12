import { client } from "@kaneo/libs";
import type { InferRequestType, InferResponseType } from "hono/client";

export type GenerateTaskIntakeDraftRequest = InferRequestType<
  (typeof client)["task"]["intake-draft"][":projectId"]["$post"]
>["json"] &
  InferRequestType<
    (typeof client)["task"]["intake-draft"][":projectId"]["$post"]
  >["param"];

export type GenerateTaskIntakeDraftResponse = InferResponseType<
  (typeof client)["task"]["intake-draft"][":projectId"]["$post"],
  200
>;

async function generateTaskIntakeDraft({
  projectId,
  rawMessage,
  images,
}: GenerateTaskIntakeDraftRequest): Promise<GenerateTaskIntakeDraftResponse> {
  const response = await client.task["intake-draft"][":projectId"].$post({
    param: { projectId },
    json: {
      ...(rawMessage ? { rawMessage } : {}),
      ...(images && images.length > 0 ? { images } : {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  return response.json();
}

export default generateTaskIntakeDraft;
