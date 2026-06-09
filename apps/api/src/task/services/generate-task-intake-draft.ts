import { GoogleGenAI, Type } from "@google/genai";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import { getAiTaskIntakeSettings } from "../../utils/get-settings";
import type {
  AiTaskIntakeInput,
  AiTaskIntakePriority,
  AiTaskIntakeResult,
} from "../types/ai-task-intake";
import { coercePriority, VALID_PRIORITIES } from "../validate-task-fields";

const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const geminiDraftOutputSchema = v.object({
  businessName: v.nullable(v.string()),
  conciseTaskTitle: v.string(),
  summary: v.string(),
  requestedChanges: v.array(v.string()),
  workerNotes: v.array(v.string()),
  priority: v.picklist(VALID_PRIORITIES),
  dueDate: v.nullable(v.string()),
  labels: v.array(v.string()),
  missingInfo: v.array(v.string()),
  confidence: v.number(),
});

type GeminiDraftOutput = v.InferOutput<typeof geminiDraftOutputSchema>;

function buildGeminiResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      businessName: {
        type: Type.STRING,
        nullable: true,
        description:
          "Client business or organization name if clearly stated. Use null if unclear.",
      },
      conciseTaskTitle: {
        type: Type.STRING,
        description:
          "Short action-oriented task title without the business prefix.",
      },
      summary: {
        type: Type.STRING,
        description: "Worker-friendly summary of the client request.",
      },
      requestedChanges: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Concrete requested changes as bullet points.",
      },
      workerNotes: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Cautions, context, or follow-up notes for the worker.",
      },
      priority: {
        type: Type.STRING,
        enum: [...VALID_PRIORITIES],
      },
      dueDate: {
        type: Type.STRING,
        nullable: true,
        description:
          "Due date in YYYY-MM-DD format only when explicitly stated. Otherwise null.",
      },
      labels: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Suggested label names only. Do not invent requirements.",
      },
      missingInfo: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Information that is unclear or missing from the message.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score from 0 to 1.",
      },
    },
    required: [
      "businessName",
      "conciseTaskTitle",
      "summary",
      "requestedChanges",
      "workerNotes",
      "priority",
      "dueDate",
      "labels",
      "missingInfo",
      "confidence",
    ],
  };
}

function buildPrompt(input: AiTaskIntakeInput): string {
  const contextLines = [
    input.workspaceName ? `Workspace: ${input.workspaceName}` : null,
    input.projectName ? `Project: ${input.projectName}` : null,
    input.existingLabels?.length
      ? `Existing label suggestions: ${input.existingLabels.join(", ")}`
      : null,
  ].filter(Boolean);

  return [
    "You are helping a project management team turn a pasted client email or message into a structured internal task draft.",
    "Rules:",
    "- Use only facts present in the client message.",
    "- Do not invent business names, URLs, due dates, priorities, or requirements.",
    "- If something is unclear, leave fields empty/null and add an item to missingInfo.",
    "- requestedChanges must be concrete, actionable bullet points.",
    "- workerNotes should include cautions, dependencies, or follow-ups.",
    "- labels are suggestions only; prefer existing labels when they fit.",
    "- dueDate must be YYYY-MM-DD or null.",
    "- priority must be one of: no-priority, low, medium, high, urgent.",
    "- confidence must be between 0 and 1.",
    contextLines.length > 0 ? `\nContext:\n${contextLines.join("\n")}` : "",
    "\nClient message:\n<<<",
    input.rawMessage,
    ">>>",
  ].join("\n");
}

function normalizeStringArray(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeDueDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || !ISO_DATE_PATTERN.test(trimmed)) {
    return null;
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return trimmed;
}

function buildTaskTitle(
  businessName: string | null,
  conciseTaskTitle: string,
): { title: string; businessName: string | null } {
  const normalizedTitle = conciseTaskTitle.trim();
  if (!normalizedTitle) {
    throw new HTTPException(502, {
      message: "AI task intake returned an empty task title",
    });
  }

  const normalizedBusinessName = businessName?.trim() || null;
  if (normalizedBusinessName) {
    return {
      title: `${normalizedBusinessName}: ${normalizedTitle}`,
      businessName: normalizedBusinessName,
    };
  }

  return {
    title: `Client: ${normalizedTitle}`,
    businessName: null,
  };
}

function sanitizeModelOutput(
  output: GeminiDraftOutput,
  rawMessage: string,
): AiTaskIntakeResult {
  const { priority } = coercePriority(output.priority);
  const { title, businessName } = buildTaskTitle(
    output.businessName,
    output.conciseTaskTitle,
  );

  return {
    title,
    businessName,
    summary: output.summary.trim(),
    requestedChanges: normalizeStringArray(output.requestedChanges),
    workerNotes: normalizeStringArray(output.workerNotes),
    originalClientMessage: rawMessage,
    priority: priority as AiTaskIntakePriority,
    dueDate: normalizeDueDate(output.dueDate),
    labels: normalizeStringArray(output.labels),
    missingInfo: normalizeStringArray(output.missingInfo),
    confidence: Math.min(1, Math.max(0, output.confidence)),
  };
}

function assertAiTaskIntakeAvailable(
  settings: ReturnType<typeof getAiTaskIntakeSettings>,
) {
  if (!settings.enabled) {
    throw new HTTPException(503, {
      message: "AI task intake is disabled",
    });
  }

  if (settings.provider !== "gemini") {
    throw new HTTPException(503, {
      message: "AI task intake provider is not supported",
    });
  }

  if (!settings.geminiApiKey) {
    throw new HTTPException(503, {
      message: "AI task intake is not configured",
    });
  }
}

export async function generateTaskIntakeDraft(
  input: AiTaskIntakeInput,
): Promise<AiTaskIntakeResult> {
  const settings = getAiTaskIntakeSettings();
  assertAiTaskIntakeAvailable(settings);

  const rawMessage = input.rawMessage.trim();
  if (!rawMessage) {
    throw new HTTPException(400, {
      message: "Client message is required",
    });
  }

  if (rawMessage.length > settings.maxInputChars) {
    throw new HTTPException(400, {
      message: `Client message exceeds the maximum length of ${settings.maxInputChars} characters`,
    });
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const response = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: buildPrompt({ ...input, rawMessage }),
      config: {
        responseMimeType: "application/json",
        responseSchema: buildGeminiResponseSchema(),
        abortSignal: abortController.signal,
        temperature: 0.2,
      },
    });

    const responseText = response.text?.trim();
    if (!responseText) {
      throw new HTTPException(502, {
        message: "AI task intake returned an empty response",
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      throw new HTTPException(502, {
        message: "AI task intake returned invalid JSON",
      });
    }

    const validatedOutput = v.parse(geminiDraftOutputSchema, parsedJson);

    return sanitizeModelOutput(validatedOutput, rawMessage);
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new HTTPException(504, {
        message: "AI task intake request timed out",
      });
    }

    if (error instanceof HTTPException) {
      throw error;
    }

    if (error instanceof v.ValiError) {
      throw new HTTPException(502, {
        message: "AI task intake returned an invalid draft shape",
      });
    }

    console.error("AI task intake generation failed:", error);
    throw new HTTPException(502, {
      message: "AI task intake generation failed",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export default generateTaskIntakeDraft;
