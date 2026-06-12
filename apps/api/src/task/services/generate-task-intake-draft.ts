import { GoogleGenAI, Type } from "@google/genai";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import { getAiTaskIntakeSettings } from "../../utils/get-settings";
import type {
  AiTaskIntakeInput,
  AiTaskIntakePriority,
  AiTaskIntakeResult,
  AiTaskIntakeSourceType,
} from "../types/ai-task-intake";
import { coercePriority, VALID_PRIORITIES } from "../validate-task-fields";
import { validateAiTaskIntakeInput } from "../validate-task-intake-input";

const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_SUBJECT_PREFIX_PATTERN = /^(Re|RE|Fwd|FW):\s*/;

const AI_TASK_INTAKE_SOURCE_TYPES = [
  "pasted_email",
  "screenshot",
  "pasted_message",
  "mixed",
] as const;

const geminiDraftOutputSchema = v.object({
  businessName: v.nullable(v.string()),
  emailSubject: v.nullable(v.string()),
  generatedTaskTitle: v.string(),
  sourceType: v.picklist(AI_TASK_INTAKE_SOURCE_TYPES),
  sourceUrls: v.array(v.string()),
  senderName: v.nullable(v.string()),
  senderEmail: v.nullable(v.string()),
  summary: v.string(),
  requestedChanges: v.array(v.string()),
  workerNotes: v.array(v.string()),
  extractedClientMessage: v.string(),
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
          "Client business, organization, or location name if clearly stated. Use null if unclear.",
      },
      emailSubject: {
        type: Type.STRING,
        nullable: true,
        description:
          "The original email subject line if present in the message. Remove only leading prefixes: Re:, RE:, Fwd:, FW:. Do not rewrite or summarize the subject. Use null if no subject line exists.",
      },
      generatedTaskTitle: {
        type: Type.STRING,
        description:
          "Short action-oriented fallback task title without business prefix. Only used when no email subject exists. Do not include the business name here.",
      },
      sourceType: {
        type: Type.STRING,
        enum: [...AI_TASK_INTAKE_SOURCE_TYPES],
        description:
          "Source type: 'pasted_email' if message has email headers (Subject/From/To/Date), 'pasted_message' if plain text with no email headers, 'screenshot' if image only, 'mixed' if image and text are both present.",
      },
      sourceUrls: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Directly relevant URLs found in the message or screenshot. Only include URLs that are part of the client request. Do not invent URLs.",
      },
      senderName: {
        type: Type.STRING,
        nullable: true,
        description:
          "Sender's name only if explicitly visible in the message headers or signature. Use null otherwise.",
      },
      senderEmail: {
        type: Type.STRING,
        nullable: true,
        description:
          "Sender's email address only if explicitly visible in the message headers. Use null otherwise.",
      },
      summary: {
        type: Type.STRING,
        description:
          "Worker-friendly summary of the client request in 1–3 short sentences. Do not include section headings.",
      },
      requestedChanges: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Concrete actionable changes. If a change involves code, include the verbatim snippet as a fenced code block (with language tag) on a new line within that item string. Do not include section headings.",
      },
      workerNotes: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Cautions, context, or follow-up notes for the worker. Use markdown links and inline code when helpful. Do not include section headings.",
      },
      extractedClientMessage: {
        type: Type.STRING,
        description:
          "Verbatim client wording from the pasted text or screenshot. Preserve original line breaks. Do not add markdown formatting, fenced code blocks, or any transformation.",
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
      "emailSubject",
      "generatedTaskTitle",
      "sourceType",
      "sourceUrls",
      "senderName",
      "senderEmail",
      "summary",
      "requestedChanges",
      "workerNotes",
      "extractedClientMessage",
      "priority",
      "dueDate",
      "labels",
      "missingInfo",
      "confidence",
    ],
  };
}

function buildPrompt(
  input: AiTaskIntakeInput & { rawMessage: string; hasImage: boolean },
): string {
  const contextLines = [
    input.workspaceName ? `Workspace: ${input.workspaceName}` : null,
    input.projectName ? `Project: ${input.projectName}` : null,
    input.existingLabels?.length
      ? `Existing label suggestions: ${input.existingLabels.join(", ")}`
      : null,
  ].filter(Boolean);

  const sourceInstructions = input.hasImage
    ? input.rawMessage
      ? "Use both the pasted text and the attached screenshot. Prefer the pasted text for extractedClientMessage when provided."
      : "The client request is in the attached screenshot. Read all visible text carefully and extract the client message verbatim into extractedClientMessage."
    : "The client request is in the pasted message below.";

  return [
    "You are helping a project management team turn a client email or message into a structured internal task draft.",
    "Rules:",
    "- Use only facts present in the client message or screenshot.",
    "- Do not invent business names, URLs, due dates, priorities, or requirements.",
    "- If something is unclear, leave fields empty/null and add an item to missingInfo.",
    "- requestedChanges must be concrete, actionable bullet points. Do not include section headings.",
    "- If a requestedChanges item involves specific code (HTML, CSS, JS, config, etc.), include the verbatim snippet as a fenced code block with a language tag on a new line within that same item.",
    "- workerNotes should include cautions, dependencies, or follow-ups. Use [label](url) for URLs and inline `backticks` for short code references. Do not include section headings.",
    "- summary should be 1–3 short sentences of worker-friendly prose. Do not repeat requestedChanges. Do not include section headings.",
    "- extractedClientMessage must be the verbatim client text with original line breaks preserved. Do not add markdown, fenced blocks, or any transformation.",
    "- emailSubject: if a Subject: line exists in the message, copy it exactly but remove only leading prefixes (Re:, RE:, Fwd:, FW:) and their whitespace. Do not rewrite or summarize the subject. The app will use this directly as the task title when present.",
    "- generatedTaskTitle: only provide a short action-oriented fallback title when NO email subject exists. When an emailSubject is provided, this field is still required but will not be used for the title.",
    "- sourceUrls: extract only URLs that are part of the client request. Do not include URLs from email headers (like unsubscribe links). Do not invent URLs.",
    "- senderName and senderEmail: extract only if explicitly visible in message headers or a signature. Use null otherwise.",
    "- sourceType: set to 'pasted_email' if the message has email headers (Subject/From/To/Date), 'pasted_message' if plain text with no headers, 'screenshot' if image only, 'mixed' if image and text are both present.",
    "- labels are suggestions only; prefer existing labels when they fit.",
    "- dueDate must be YYYY-MM-DD or null.",
    "- priority must be one of: no-priority, low, medium, high, urgent.",
    "- confidence must be between 0 and 1.",
    "- Do not escape markdown characters unnecessarily.",
    sourceInstructions,
    contextLines.length > 0 ? `\nContext:\n${contextLines.join("\n")}` : "",
    input.rawMessage ? `\nClient message:\n<<<\n${input.rawMessage}\n>>>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGeminiContents(
  input: AiTaskIntakeInput & { rawMessage: string; hasImage: boolean },
) {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  if (input.image) {
    parts.push({
      inlineData: {
        mimeType: input.image.mimeType,
        data: input.image.data,
      },
    });
  }

  parts.push({ text: buildPrompt(input) });

  return parts;
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

function cleanEmailSubject(subject: string | null): string | null {
  if (!subject) return null;
  let cleaned = subject.trim();
  // Strip repeated prefixes: "Re: Re: FW: Subject" → "Subject"
  let prev = "";
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(EMAIL_SUBJECT_PREFIX_PATTERN, "").trim();
  }
  return cleaned || null;
}

function titleStartsWithBusinessName(
  titleBase: string,
  businessName: string,
): boolean {
  const normalizedTitle = titleBase.toLowerCase();
  const normalizedBusiness = businessName.toLowerCase();
  if (!normalizedTitle.startsWith(normalizedBusiness)) return false;
  // Allow the match only when it is at a word boundary — i.e. the title is
  // exactly the business name, or the next character is a space or colon.
  const charAfter = normalizedTitle[normalizedBusiness.length];
  return charAfter === undefined || charAfter === " " || charAfter === ":";
}

function buildDeterministicTitle(
  businessName: string | null,
  emailSubject: string | null,
  generatedTaskTitle: string,
): string {
  const cleanedSubject = cleanEmailSubject(emailSubject);
  const fallbackTitle = generatedTaskTitle.trim() || "New client request";
  const titleBase = cleanedSubject || fallbackTitle;

  if (businessName && !titleStartsWithBusinessName(titleBase, businessName)) {
    return `${businessName}: ${titleBase}`;
  }

  return titleBase;
}

function resolveSourceType(
  geminiSourceType: AiTaskIntakeSourceType,
  imageOnly: boolean,
  hasImage: boolean,
  hasRawMessage: boolean,
): AiTaskIntakeSourceType {
  if (imageOnly) return "screenshot";
  if (hasImage && hasRawMessage) return "mixed";
  return geminiSourceType;
}

function resolveOriginalClientMessage(
  rawMessage: string,
  extractedClientMessage: string,
  imageOnly: boolean,
): string {
  if (rawMessage) {
    return rawMessage;
  }

  const extracted = extractedClientMessage.trim();
  if (!extracted) {
    return imageOnly ? "Content extracted from uploaded screenshot." : "";
  }

  if (imageOnly) {
    return `${extracted}\n\n(Extracted from uploaded screenshot.)`;
  }

  return extracted;
}

function sanitizeModelOutput(
  output: GeminiDraftOutput,
  rawMessage: string,
  imageOnly: boolean,
  hasImage: boolean,
): AiTaskIntakeResult {
  const { priority } = coercePriority(output.priority);

  const businessName = output.businessName?.trim() || null;
  const emailSubject = output.emailSubject?.trim() || null;
  const generatedTaskTitle = output.generatedTaskTitle?.trim() || "";

  if (!generatedTaskTitle && !emailSubject) {
    throw new HTTPException(502, {
      message: "AI task intake returned an empty task title",
    });
  }

  const title = buildDeterministicTitle(
    businessName,
    emailSubject,
    generatedTaskTitle,
  );

  const sourceType = resolveSourceType(
    output.sourceType,
    imageOnly,
    hasImage,
    Boolean(rawMessage),
  );

  return {
    title,
    businessName,
    emailSubject: cleanEmailSubject(emailSubject),
    generatedTaskTitle: generatedTaskTitle || null,
    sourceType,
    sourceUrls: normalizeStringArray(output.sourceUrls),
    senderName: output.senderName?.trim() || null,
    senderEmail: output.senderEmail?.trim() || null,
    summary: output.summary.trim(),
    requestedChanges: normalizeStringArray(output.requestedChanges),
    workerNotes: normalizeStringArray(output.workerNotes),
    originalClientMessage: resolveOriginalClientMessage(
      rawMessage,
      output.extractedClientMessage,
      imageOnly,
    ),
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

  const validatedInput = validateAiTaskIntakeInput(input, {
    maxInputChars: settings.maxInputChars,
    maxImageBytes: settings.maxImageBytes,
  });

  const imageOnly = !validatedInput.rawMessage && Boolean(validatedInput.image);
  const geminiInput = {
    ...validatedInput,
    hasImage: Boolean(validatedInput.image),
  };

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, GEMINI_REQUEST_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const response = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: buildGeminiContents(geminiInput),
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

    return sanitizeModelOutput(
      validatedOutput,
      validatedInput.rawMessage,
      imageOnly,
      geminiInput.hasImage,
    );
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
