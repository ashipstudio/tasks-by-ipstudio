import { GoogleGenAI, Type } from "@google/genai";
import { desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import db from "../../database";
import { activityTable, taskTable, userTable } from "../../database/schema";
import { getAiTaskIntakeSettings } from "../../utils/get-settings";
import {
  AI_TASK_INTAKE_ALLOWED_IMAGE_MIME_TYPES,
  type AiTaskIntakeImageInput,
} from "../types/ai-task-intake";
import type {
  AiTaskUpdateInput,
  AiTaskUpdateProposal,
} from "../types/ai-task-update";
import { VALID_PRIORITIES } from "../validate-task-fields";

const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DESCRIPTION_MAX_CHARS = 1500;
const RECENT_ACTIVITY_LIMIT = 10;

// ---------------------------------------------------------------------------
// Gemini output schema (internal — maps 1:1 to AiTaskUpdateProposal)
// ---------------------------------------------------------------------------

const geminiUpdateOutputSchema = v.object({
  latestUpdateSummary: v.string(),
  newRequestedChanges: v.array(v.string()),
  changedRequirements: v.array(v.string()),
  supersededRequests: v.array(v.string()),
  suggestedComment: v.string(),
  suggestedDescriptionAppend: v.string(),
  suggestedPriority: v.nullable(v.picklist(VALID_PRIORITIES)),
  suggestedDueDate: v.nullable(v.string()),
  missingInfo: v.array(v.string()),
  confidence: v.number(),
});

type GeminiUpdateOutput = v.InferOutput<typeof geminiUpdateOutputSchema>;

// ---------------------------------------------------------------------------
// Gemini structured-output response schema
// ---------------------------------------------------------------------------

function buildGeminiUpdateResponseSchema() {
  return {
    type: Type.OBJECT,
    properties: {
      latestUpdateSummary: {
        type: Type.STRING,
        description:
          "A concise 1–3 sentence worker-friendly summary of the latest client update. Focus on what changed or what is newly requested.",
      },
      newRequestedChanges: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Net-new actionable changes requested in this update that were not already in the task. Do not repeat previously captured items. Do not include section headings inside list items.",
      },
      changedRequirements: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Requirements that were mentioned before but now have different details, scope, or wording. Describe both the original and the new version briefly. Do not include section headings.",
      },
      supersededRequests: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Previously requested items that the client has now cancelled, replaced, or said are no longer needed. Do not include section headings.",
      },
      suggestedComment: {
        type: Type.STRING,
        description:
          "A short, professional comment the user may post on the task to acknowledge receipt of this update. Do not auto-post; this is only a suggestion for the user to review and send manually. 2–4 sentences max.",
      },
      suggestedDescriptionAppend: {
        type: Type.STRING,
        description:
          "A clean markdown block the user may optionally append to the task description. Use the following format exactly (include only sections that have content, omit empty sections):\n\n## Update — {TODAY_DATE}\n\n### Latest Update\n{latestUpdateSummary}\n\n### New Requested Changes\n- ...\n\n### Changed Requirements\n- ...\n\n### Superseded Requests\n- ...\n\n### Missing Info\n- ...\n\nDo not apply this to the task automatically. It is a proposal only.",
      },
      suggestedPriority: {
        type: Type.STRING,
        enum: [...VALID_PRIORITIES],
        nullable: true,
        description:
          "Suggested updated priority only when the new update clearly justifies a change. Use 'urgent' only for site-down, broken checkout, or explicit same-day emergency. Use 'high' for time-sensitive or client-emphasised items. Use null when no priority change is needed or the signal is unclear.",
      },
      suggestedDueDate: {
        type: Type.STRING,
        nullable: true,
        description:
          "Updated due date in YYYY-MM-DD format only when the client explicitly states a new or changed deadline in this update. Use null otherwise. Do not invent deadlines.",
      },
      missingInfo: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Information that is still unclear, ambiguous, or missing after reading this update. Do not invent questions.",
      },
      confidence: {
        type: Type.NUMBER,
        description: "Confidence score from 0 to 1 for this update analysis.",
      },
    },
    required: [
      "latestUpdateSummary",
      "newRequestedChanges",
      "changedRequirements",
      "supersededRequests",
      "suggestedComment",
      "suggestedDescriptionAppend",
      "suggestedPriority",
      "suggestedDueDate",
      "missingInfo",
      "confidence",
    ],
  };
}

// ---------------------------------------------------------------------------
// Image validation (single image for Phase 2)
// ---------------------------------------------------------------------------

function stripBase64Prefix(data: string): string {
  const match = data.match(/^data:[^;]+;base64,(.+)$/s);
  return (match?.[1] ?? data).replace(/\s/g, "");
}

function getBase64ByteLength(base64: string): number {
  const normalized = base64.replace(/\s/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function validateUpdateImage(
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
      message: "Screenshot must be PNG, JPEG, or WebP",
    });
  }

  const data = stripBase64Prefix(image.data.trim());
  if (!data) {
    throw new HTTPException(400, { message: "Screenshot data is required" });
  }

  if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
    throw new HTTPException(400, {
      message: "Screenshot data must be valid base64",
    });
  }

  const byteLength = getBase64ByteLength(data);
  if (byteLength <= 0) {
    throw new HTTPException(400, { message: "Screenshot data is required" });
  }

  if (byteLength > maxImageBytes) {
    throw new HTTPException(400, {
      message: `Screenshot exceeds the maximum size of ${maxImageBytes} bytes`,
    });
  }

  return {
    mimeType: mimeType as AiTaskIntakeImageInput["mimeType"],
    data,
  };
}

// ---------------------------------------------------------------------------
// Input normalization — resolve image from image/images[], cap at one image
// ---------------------------------------------------------------------------

type ValidatedUpdateInput = {
  rawMessage: string;
  image: AiTaskIntakeImageInput | null;
};

function normalizeUpdateInput(
  input: AiTaskUpdateInput,
  options: { maxInputChars: number; maxImageBytes: number },
): ValidatedUpdateInput {
  const rawMessage = input.rawMessage?.trim() ?? "";

  // Phase 2: accept both `image` and `images[]`, use only the first image.
  const rawImage =
    input.images && input.images.length > 0
      ? input.images[0]
      : (input.image ?? null);

  const hasText = rawMessage.length > 0;
  const hasImage = rawImage != null;

  if (!hasText && !hasImage) {
    throw new HTTPException(400, {
      message: "Either a message or a screenshot is required",
    });
  }

  if (hasText && rawMessage.length > options.maxInputChars) {
    throw new HTTPException(400, {
      message: `Message exceeds the maximum length of ${options.maxInputChars} characters`,
    });
  }

  const validatedImage = hasImage
    ? validateUpdateImage(
        rawImage as AiTaskIntakeImageInput,
        options.maxImageBytes,
      )
    : null;

  return { rawMessage, image: validatedImage };
}

// ---------------------------------------------------------------------------
// Compact task context — assembled fresh for each call; never unbounded
// ---------------------------------------------------------------------------

type CompactActivity = {
  type: string;
  content: string | null;
  eventData: unknown;
  createdAt: Date;
};

type CompactTaskContext = {
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  assigneeName: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  recentActivity: CompactActivity[];
};

async function assembleCompactTaskContext(
  taskId: string,
): Promise<CompactTaskContext> {
  const taskRows = await db
    .select({
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      assigneeName: userTable.name,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!taskRows.length || !taskRows[0]) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  const task = taskRows[0];

  // Fetch the most recent RECENT_ACTIVITY_LIMIT items, ordered newest-first.
  // Prefer comments and meaningful change events; skip noisy system noise by
  // choosing a small, bounded slice rather than the full unbounded history.
  const activityRows = await db
    .select({
      type: activityTable.type,
      content: activityTable.content,
      eventData: activityTable.eventData,
      createdAt: activityTable.createdAt,
    })
    .from(activityTable)
    .where(eq(activityTable.taskId, taskId))
    .orderBy(desc(activityTable.createdAt))
    .limit(RECENT_ACTIVITY_LIMIT);

  return {
    title: task.title,
    description: task.description ?? null,
    status: task.status,
    priority: task.priority ?? null,
    assigneeName: task.assigneeName ?? null,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    recentActivity: activityRows,
  };
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function formatActivityForPrompt(activity: CompactActivity[]): string {
  if (!activity.length) return "No recent activity.";

  return activity
    .map((item) => {
      const ts = item.createdAt.toISOString().slice(0, 10);
      if (item.type === "comment" && item.content) {
        const text = item.content.replace(/\n+/g, " ").slice(0, 300);
        return `[${ts}] comment: ${text}`;
      }
      if (item.eventData && typeof item.eventData === "object") {
        const d = item.eventData as Record<string, unknown>;
        const detail =
          d.from !== undefined && d.to !== undefined
            ? `${d.from} → ${d.to}`
            : JSON.stringify(d).slice(0, 120);
        return `[${ts}] ${item.type}: ${detail}`;
      }
      return `[${ts}] ${item.type}`;
    })
    .join("\n");
}

function truncateDescription(description: string | null): string {
  if (!description) return "(no description)";
  if (description.length <= DESCRIPTION_MAX_CHARS) return description;
  return `${description.slice(0, DESCRIPTION_MAX_CHARS)}\n... [description truncated]`;
}

function buildUpdatePrompt(
  context: CompactTaskContext,
  rawMessage: string,
  hasImage: boolean,
  todayIso: string,
): string {
  const inputInstructions = hasImage
    ? rawMessage
      ? "The client update includes both pasted text and one attached screenshot. Use both as context."
      : "The client update is in the attached screenshot. Read all visible text carefully."
    : "The client update is in the pasted message below.";

  const taskLines = [
    `**Task Title:** ${context.title}`,
    `**Status:** ${context.status}`,
    `**Priority:** ${context.priority ?? "no-priority"}`,
    context.assigneeName ? `**Assignee:** ${context.assigneeName}` : null,
    context.startDate
      ? `**Start Date:** ${context.startDate.toISOString().slice(0, 10)}`
      : null,
    context.dueDate
      ? `**Due Date:** ${context.dueDate.toISOString().slice(0, 10)}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return [
    "You are helping a project management team analyse a new client update for an existing task.",
    "You have been given the current task context and the new client message.",
    `Today's date is ${todayIso}.`,
    "",
    "Rules:",
    "- Treat the new client update as the most recent source of truth.",
    "- Compare it against the existing task context to identify what is net-new, what changed, and what is now superseded.",
    "- Do not invent facts, URLs, people, deadlines, or requirements.",
    "- newRequestedChanges: only items not already captured in the task description or previous activity.",
    "- changedRequirements: items that existed before but now have different scope, detail, or wording.",
    "- supersededRequests: items the client has cancelled, replaced, or said are no longer needed.",
    "- suggestedComment: a short, professional comment for the worker to optionally post. Do not auto-post.",
    "- suggestedDescriptionAppend: format as a clean markdown block using today's date (" +
      todayIso +
      "). Only include sections that have content.",
    "- suggestedPriority: suggest a change only when clearly justified by the update. Use null if no change is needed.",
    "- suggestedDueDate: YYYY-MM-DD only when the client states a new deadline explicitly. Use null otherwise.",
    "- missingInfo: only genuine gaps or ambiguities. Do not over-generate questions.",
    "- confidence must be between 0 and 1.",
    "- Do not include section headings inside individual string array items (newRequestedChanges, changedRequirements, etc.).",
    inputInstructions,
    "",
    "## Current Task Context",
    taskLines,
    "",
    "### Current Description",
    truncateDescription(context.description),
    "",
    `### Recent Activity (last ${context.recentActivity.length} items, newest first)`,
    formatActivityForPrompt(context.recentActivity),
    "",
    rawMessage ? `## New Client Update\n<<<\n${rawMessage}\n>>>` : "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function buildGeminiUpdateContents(
  context: CompactTaskContext,
  rawMessage: string,
  image: AiTaskIntakeImageInput | null,
  todayIso: string,
) {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (image) {
    parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  parts.push({
    text: buildUpdatePrompt(context, rawMessage, image != null, todayIso),
  });

  return parts;
}

// ---------------------------------------------------------------------------
// Output sanitisation
// ---------------------------------------------------------------------------

function normalizeStringArray(values: string[]): string[] {
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !ISO_DATE_PATTERN.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

function sanitizeUpdateOutput(
  output: GeminiUpdateOutput,
): AiTaskUpdateProposal {
  const suggestedPriority =
    output.suggestedPriority != null &&
    (VALID_PRIORITIES as readonly string[]).includes(output.suggestedPriority)
      ? (output.suggestedPriority as (typeof VALID_PRIORITIES)[number])
      : null;

  return {
    latestUpdateSummary: output.latestUpdateSummary.trim(),
    newRequestedChanges: normalizeStringArray(output.newRequestedChanges),
    changedRequirements: normalizeStringArray(output.changedRequirements),
    supersededRequests: normalizeStringArray(output.supersededRequests),
    suggestedComment: output.suggestedComment.trim(),
    suggestedDescriptionAppend: output.suggestedDescriptionAppend.trim(),
    suggestedPriority,
    suggestedDueDate: normalizeIsoDate(output.suggestedDueDate),
    missingInfo: normalizeStringArray(output.missingInfo),
    confidence: Math.min(1, Math.max(0, output.confidence)),
  };
}

// ---------------------------------------------------------------------------
// Feature flag guard
// ---------------------------------------------------------------------------

function assertAiAvailable(
  settings: ReturnType<typeof getAiTaskIntakeSettings>,
) {
  if (!settings.enabled) {
    throw new HTTPException(503, { message: "AI task intake is disabled" });
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generateTaskUpdateDraft(
  taskId: string,
  input: AiTaskUpdateInput,
): Promise<AiTaskUpdateProposal> {
  const settings = getAiTaskIntakeSettings();
  assertAiAvailable(settings);

  const validatedInput = normalizeUpdateInput(input, {
    maxInputChars: settings.maxInputChars,
    maxImageBytes: settings.maxImageBytes,
  });

  const context = await assembleCompactTaskContext(taskId);

  const todayIso = new Date().toISOString().slice(0, 10);

  const contents = buildGeminiUpdateContents(
    context,
    validatedInput.rawMessage,
    validatedInput.image,
    todayIso,
  );

  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    GEMINI_REQUEST_TIMEOUT_MS,
  );

  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const response = await ai.models.generateContent({
      model: settings.geminiModel,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: buildGeminiUpdateResponseSchema(),
        abortSignal: abortController.signal,
        temperature: 0.2,
      },
    });

    const responseText = response.text?.trim();
    if (!responseText) {
      throw new HTTPException(502, {
        message: "AI task update returned an empty response",
      });
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(responseText);
    } catch {
      throw new HTTPException(502, {
        message: "AI task update returned invalid JSON",
      });
    }

    const validatedOutput = v.parse(geminiUpdateOutputSchema, parsedJson);

    return sanitizeUpdateOutput(validatedOutput);
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new HTTPException(504, {
        message: "AI task update request timed out",
      });
    }

    if (error instanceof HTTPException) throw error;

    if (error instanceof v.ValiError) {
      throw new HTTPException(502, {
        message: "AI task update returned an invalid proposal shape",
      });
    }

    console.error("AI task update draft generation failed:", error);
    throw new HTTPException(502, {
      message: "AI task update generation failed",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export default generateTaskUpdateDraft;
