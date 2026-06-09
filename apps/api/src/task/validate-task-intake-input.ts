import { HTTPException } from "hono/http-exception";
import {
  AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES,
  type AiTaskIntakeImageInput,
  type AiTaskIntakeInput,
} from "./types/ai-task-intake";

export type ValidatedAiTaskIntakeInput = {
  rawMessage: string;
  image?: AiTaskIntakeImageInput;
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
): AiTaskIntakeImageInput {
  const mimeType = image.mimeType.trim().toLowerCase();
  if (
    !AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES.includes(
      mimeType as (typeof AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES)[number],
    )
  ) {
    throw new HTTPException(400, {
      message: "Image must be PNG, JPEG, or WebP",
    });
  }

  const data = stripBase64Prefix(image.data.trim());
  if (!data) {
    throw new HTTPException(400, {
      message: "Image data is required",
    });
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new HTTPException(400, {
      message: "Image data must be valid base64",
    });
  }

  const byteLength = getBase64ByteLength(data);
  if (byteLength <= 0) {
    throw new HTTPException(400, {
      message: "Image data is required",
    });
  }

  if (byteLength > maxImageBytes) {
    throw new HTTPException(400, {
      message: `Image exceeds the maximum size of ${maxImageBytes} bytes`,
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
  const hasImage = Boolean(input.image?.data?.trim());

  if (!hasText && !hasImage) {
    throw new HTTPException(400, {
      message: "Either a client message or an image is required",
    });
  }

  if (hasText && rawMessage.length > options.maxInputChars) {
    throw new HTTPException(400, {
      message: `Client message exceeds the maximum length of ${options.maxInputChars} characters`,
    });
  }

  const validatedImage = hasImage
    ? validateImage(
        input.image as AiTaskIntakeImageInput,
        options.maxImageBytes,
      )
    : undefined;

  return {
    rawMessage,
    image: validatedImage,
    projectName: input.projectName,
    workspaceName: input.workspaceName,
    existingLabels: input.existingLabels,
  };
}
