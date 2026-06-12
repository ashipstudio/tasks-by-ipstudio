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
const DEFAULT_DUE_DATE_BUSINESS_DAYS = 3;

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
  priorityReason: v.nullable(v.string()),
  dueDate: v.nullable(v.string()),
  dueDateReason: v.nullable(v.string()),
  shouldUseDefaultDueDate: v.boolean(),
  startDate: v.nullable(v.string()),
  startDateReason: v.nullable(v.string()),
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
        description:
          "Task priority inferred from client language. Use: 'urgent' only for site down, broken checkout, non-working forms, launch-blocking issues, or explicit same-day emergencies with real business impact. 'high' for time-sensitive tasks, needed before an event or launch, or when client explicitly emphasizes importance. 'medium' for normal actionable tasks. 'low' for tasks marked as no rush or low impact. 'no-priority' when unclear or insufficient context.",
      },
      priorityReason: {
        type: Type.STRING,
        nullable: true,
        description:
          "One short sentence explaining why this priority was chosen. Example: 'Client described the form as not receiving submissions.' Use null if priority is no-priority and no clear signal exists.",
      },
      dueDate: {
        type: Type.STRING,
        nullable: true,
        description:
          "Explicit due date in YYYY-MM-DD format only when the client clearly states a deadline. Examples: 'by Friday', 'before June 20', 'needed for launch on July 1', 'can this be done tomorrow?', 'before our event next Wednesday'. Use today's date context to resolve relative dates. Return null if no explicit deadline is stated.",
      },
      dueDateReason: {
        type: Type.STRING,
        nullable: true,
        description:
          "One short sentence explaining the due date. Example: 'Client requested completion before launch on June 20.' Use null when no explicit deadline was found.",
      },
      shouldUseDefaultDueDate: {
        type: Type.BOOLEAN,
        description:
          "Set to true only when: (1) the request is actionable and clear, AND (2) no explicit due date was stated. Set to false if the request is vague, spam, or missing key info, or if an explicit dueDate was already provided.",
      },
      startDate: {
        type: Type.STRING,
        nullable: true,
        description:
          "Start date in YYYY-MM-DD format only when the client clearly states when work should begin. Examples: 'please start this Monday', 'do not begin until June 12', 'start after the campaign launches'. Do not guess a start date from normal task timing. Use null if not explicitly stated.",
      },
      startDateReason: {
        type: Type.STRING,
        nullable: true,
        description:
          "One short sentence explaining the start date. Example: 'Client asked not to begin until Monday.' Use null when startDate is null.",
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
      "priorityReason",
      "dueDate",
      "dueDateReason",
      "shouldUseDefaultDueDate",
      "startDate",
      "startDateReason",
      "labels",
      "missingInfo",
      "confidence",
    ],
  };
}

function buildPrompt(
  input: AiTaskIntakeInput & {
    rawMessage: string;
    imageCount: number;
  },
): string {
  const contextLines = [
    input.workspaceName ? `Workspace: ${input.workspaceName}` : null,
    input.projectName ? `Project: ${input.projectName}` : null,
    input.existingLabels?.length
      ? `Existing label suggestions: ${input.existingLabels.join(", ")}`
      : null,
  ].filter(Boolean);

  const sourceInstructions =
    input.imageCount > 0
      ? input.rawMessage
        ? input.imageCount > 1
          ? `Use the pasted text and all ${input.imageCount} attached screenshots as related context for the same task. Prefer the pasted text for extractedClientMessage when provided. Extract details across all screenshots.`
          : "Use both the pasted text and the attached screenshot. Prefer the pasted text for extractedClientMessage when provided."
        : input.imageCount > 1
          ? `The client request is spread across ${input.imageCount} attached screenshots. Read all visible text carefully across all images. Treat them as related context for the same task. Extract the client message verbatim into extractedClientMessage.`
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
    "- emailSubject: if a Subject: line exists in the message, copy it exactly but remove only leading prefixes (Re:, RE:, Fwd:, FW:) and their whitespace. Do not rewrite or summarize the subject.",
    "- generatedTaskTitle: only provide a short action-oriented fallback title when NO email subject exists.",
    "- sourceUrls: extract only URLs that are part of the client request. Do not include email header URLs. Do not invent URLs.",
    "- senderName and senderEmail: extract only if explicitly visible in message headers or a signature. Use null otherwise.",
    "- sourceType: 'pasted_email' if headers present, 'pasted_message' if plain text, 'screenshot' if image only, 'mixed' if image and text.",
    "- priority: use 'urgent' only for site down, broken checkout, non-working forms, launch-blocking issues, or explicit same-day emergencies with real business impact. Use 'high' for time-sensitive tasks or client-emphasized importance. Use 'medium' for normal tasks. Use 'low' for no-rush requests. Use 'no-priority' when unclear.",
    "- priorityReason: one sentence explaining the priority choice. Null if no-priority and no clear signal.",
    "- dueDate: YYYY-MM-DD only when the client states a clear deadline. Examples: 'by Friday', 'before June 20', 'needed for launch on July 1', 'can this be done tomorrow?', 'before our event next Wednesday'. Resolve relative dates using today's date. Return null if no explicit deadline.",
    "- dueDateReason: one sentence explaining the due date. Null when no explicit deadline.",
    "- shouldUseDefaultDueDate: true only if the request is actionable AND no explicit due date was stated. False if vague/spam/unclear or if dueDate was already set.",
    "- startDate: YYYY-MM-DD only when the client clearly states when work should begin. Examples: 'please start this Monday', 'do not begin until June 12'. Do not guess. Null if not stated.",
    "- startDateReason: one sentence explaining the start date. Null when startDate is null.",
    "- labels are suggestions only; prefer existing labels when they fit.",
    "- dueDate and startDate must be YYYY-MM-DD or null.",
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
  input: AiTaskIntakeInput & {
    rawMessage: string;
    imageCount: number;
  },
) {
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [];

  for (const img of input.images ?? []) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
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

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || !ISO_DATE_PATTERN.test(trimmed)) return null;
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return trimmed;
}

/**
 * Adds N business days (Mon–Fri) to a date, ignoring weekends.
 * Holidays are not accounted for.
 */
function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      added++;
    }
  }
  return result;
}

function toIsoDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  // Only a true match when followed by a word boundary (space, colon, or end)
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

function resolveDueDate(
  explicitDueDate: string | null,
  shouldUseDefault: boolean,
): { dueDate: string | null; dueDateReason: string | null } {
  if (explicitDueDate) {
    return { dueDate: explicitDueDate, dueDateReason: null };
  }

  if (shouldUseDefault) {
    const defaultDate = addBusinessDays(new Date(), DEFAULT_DUE_DATE_BUSINESS_DAYS);
    return {
      dueDate: toIsoDateString(defaultDate),
      dueDateReason:
        "No explicit deadline; applied standard 3 business day processing target.",
    };
  }

  return { dueDate: null, dueDateReason: null };
}

function sanitizeModelOutput(
  output: GeminiDraftOutput,
  rawMessage: string,
  imageOnly: boolean,
  imageCount: number,
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
    imageCount > 0,
    Boolean(rawMessage),
  );

  const explicitDueDate = normalizeIsoDate(output.dueDate);
  const { dueDate, dueDateReason: defaultDueDateReason } = resolveDueDate(
    explicitDueDate,
    output.shouldUseDefaultDueDate,
  );

  const dueDateReason =
    output.dueDateReason?.trim() || defaultDueDateReason || null;

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
    priorityReason: output.priorityReason?.trim() || null,
    dueDate,
    dueDateReason,
    startDate: normalizeIsoDate(output.startDate),
    startDateReason: output.startDate
      ? (output.startDateReason?.trim() || null)
      : null,
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

  const imageCount = validatedInput.images.length;
  const imageOnly = !validatedInput.rawMessage && imageCount > 0;
  const geminiInput = {
    ...validatedInput,
    imageCount,
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
      imageCount,
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
