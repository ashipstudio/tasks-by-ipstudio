import { HTTPException } from "hono/http-exception";
import {
  AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES,
  AI_TASK_INTAKE_MAX_IMAGES,
  type AiTaskIntakeImageInput,
  type AiTaskIntakeInput,
} from "./types/ai-task-intake";

export type ValidatedAiTaskIntakeInput = {
  rawMessage: string;
  images: AiTaskIntakeImageInput[];
  projectName?: string;
  workspaceName?: string;
  existingLabels?: string[];
};

function stripBase64Prefix(data: string): string {
  const match = data.match(/^data:[^;]+;base64,(.+)$/s);
  return (match?.[1] ?? data).replace(/\s/g, "");
}

function getBase64ByteLength(base64: string): number {
  const normalized = base64.replace(/\s/g, "");
  if (!normalized) {
    return 0;
  }

  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;

  return Math.floor((normalized.length * 3) / 4) - padding;
}

function validateImage(
  image: AiTaskIntakeImageInput,
  maxImageBytes: number,
  index: number,
): AiTaskIntakeImageInput {
  const label = `Image ${index + 1}`;

  const mimeType = image.mimeType.trim().toLowerCase();
  if (
    !AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES.includes(
      mimeType as (typeof AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES)[number],
    )
  ) {
    throw new HTTPException(400, {
      message: `${label} must be PNG, JPEG, or WebP`,
    });
  }

  const data = stripBase64Prefix(image.data.trim());
  if (!data) {
    throw new HTTPException(400, {
      message: `${label} data is required`,
    });
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new HTTPException(400, {
      message: `${label} data must be valid base64`,
    });
  }

  const byteLength = getBase64ByteLength(data);
  if (byteLength <= 0) {
    throw new HTTPException(400, {
      message: `${label} data is required`,
    });
  }

  if (byteLength > maxImageBytes) {
    throw new HTTPException(400, {
      message: `${label} exceeds the maximum size of ${maxImageBytes} bytes`,
    });
  }

  return {
    mimeType: mimeType as AiTaskIntakeImageInput["mimeType"],
    data,
  };
}

export function validateAiTaskIntakeInput(
  input: AiTaskIntakeInput,
  options: { maxInputChars: number; maxImageBytes: number },
): ValidatedAiTaskIntakeInput {
  const rawMessage = input.rawMessage?.trim() ?? "";
  const hasText = rawMessage.length > 0;
  const rawImages = input.images ?? [];
  const hasImages = rawImages.length > 0;

  if (!hasText && !hasImages) {
    throw new HTTPException(400, {
      message: "Either a client message or an image is required",
    });
  }

  if (hasText && rawMessage.length > options.maxInputChars) {
    throw new HTTPException(400, {
      message: `Client message exceeds the maximum length of ${options.maxInputChars} characters`,
    });
  }

  if (rawImages.length > AI_TASK_INTAKE_MAX_IMAGES) {
    throw new HTTPException(400, {
      message: `A maximum of ${AI_TASK_INTAKE_MAX_IMAGES} screenshots can be submitted`,
    });
  }

  const validatedImages = rawImages.map((img, i) =>
    validateImage(img, options.maxImageBytes, i),
  );

  return {
    rawMessage,
    images: validatedImages,
    projectName: input.projectName,
    workspaceName: input.workspaceName,
    existingLabels: input.existingLabels,
  };
}
