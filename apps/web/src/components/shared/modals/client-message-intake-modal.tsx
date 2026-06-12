import {
  AlertCircle,
  ChevronDown,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ClipboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { GenerateTaskIntakeDraftResponse } from "@/fetchers/task/generate-task-intake-draft";
import useGenerateTaskIntakeDraft from "@/hooks/mutations/task/use-generate-task-intake-draft";
import { cn } from "@/lib/cn";
import { formatTaskIntakeDescription } from "@/lib/format-task-intake-markdown";

type Priority = "no-priority" | "low" | "medium" | "high" | "urgent";

type AppliedIntakeDraft = {
  title: string;
  description: string;
  priority: Priority;
  dueDate?: Date;
  startDate?: Date;
};

type ClientMessageIntakeModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onApply: (draft: AppliedIntakeDraft) => void;
};

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 3;

type UploadedImage = {
  mimeType: (typeof ALLOWED_IMAGE_TYPES)[number];
  data: string;
  previewUrl: string;
  fileName: string;
  fileSize: number;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getClipboardImageFiles(
  clipboardData: DataTransfer | null,
): File[] | "unsupported" | null {
  if (!clipboardData) {
    return null;
  }

  const files: File[] = [];
  let hasUnsupportedImage = false;

  for (const item of clipboardData.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }

    if (
      ALLOWED_IMAGE_TYPES.includes(
        item.type as (typeof ALLOWED_IMAGE_TYPES)[number],
      )
    ) {
      const file = item.getAsFile();
      if (file) {
        files.push(file);
      }
    } else {
      hasUnsupportedImage = true;
    }
  }

  if (files.length > 0) return files;
  return hasUnsupportedImage ? "unsupported" : null;
}

async function readImageAsBase64(
  file: File,
): Promise<{ mimeType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read image"));
        return;
      }

      const base64 = result.includes(",")
        ? (result.split(",")[1] ?? "")
        : result;
      resolve({ mimeType: file.type, data: base64 });
    };
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function parseDueDate(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return undefined;
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsed = new Date(year, monthIndex, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== monthIndex ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }

  return parsed;
}

function ReviewSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

type AiGenerateButtonProps = {
  canGenerate: boolean;
  isPending: boolean;
  onClick: () => void;
};

function AiGenerateButton({
  canGenerate,
  isPending,
  onClick,
}: AiGenerateButtonProps) {
  const hasAiStyle = canGenerate;
  const isDisabled = !canGenerate || isPending;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent font-medium outline-none transition-all sm:text-sm",
        "h-8 px-[calc(--spacing(2.5)-1px)] text-sm",
        "text-foreground",
        hasAiStyle &&
          !isPending && [
            "kaneo-ai-btn",
            "shadow-[0_0_8px_-3px_rgba(103,232,249,0.25),0_0_8px_-3px_rgba(167,139,250,0.25),0_0_8px_-3px_rgba(240,171,252,0.2)]",
            "dark:shadow-[0_0_10px_-2px_rgba(103,232,249,0.3),0_0_10px_-2px_rgba(167,139,250,0.3),0_0_10px_-2px_rgba(240,171,252,0.25)]",
            "hover:shadow-[0_0_14px_-2px_rgba(103,232,249,0.4),0_0_14px_-2px_rgba(167,139,250,0.38),0_0_14px_-2px_rgba(240,171,252,0.35)]",
            "hover:dark:shadow-[0_0_18px_-2px_rgba(103,232,249,0.45),0_0_18px_-2px_rgba(167,139,250,0.42),0_0_18px_-2px_rgba(240,171,252,0.38)]",
            "hover:-translate-y-px",
            "active:translate-y-0 active:scale-[0.97] active:shadow-none active:opacity-80",
          ],
        hasAiStyle &&
          isPending && [
            "kaneo-ai-btn",
            "cursor-not-allowed",
            "shadow-[0_0_10px_-3px_rgba(103,232,249,0.28),0_0_10px_-3px_rgba(167,139,250,0.28),0_0_10px_-3px_rgba(240,171,252,0.22)]",
            "dark:shadow-[0_0_12px_-2px_rgba(103,232,249,0.32),0_0_12px_-2px_rgba(167,139,250,0.32),0_0_12px_-2px_rgba(240,171,252,0.26)]",
          ],
        !hasAiStyle && "cursor-not-allowed opacity-50",
      )}
    >
      {isPending ? (
        <Loader2
          aria-hidden
          className="size-3.5 animate-spin text-violet-400 dark:text-violet-300"
        />
      ) : (
        <Sparkles
          aria-hidden
          className={cn(
            "size-3.5 text-violet-400 dark:text-violet-300",
            hasAiStyle && "motion-safe:animate-pulse",
          )}
        />
      )}
      <span>{isPending ? "Generating…" : "Generate Draft"}</span>
    </button>
  );
}

function ClientMessageIntakeModal({
  open,
  onClose,
  projectId,
  onApply,
}: ClientMessageIntakeModalProps) {
  const [rawMessage, setRawMessage] = useState("");
  const [draft, setDraft] = useState<GenerateTaskIntakeDraftResponse | null>(
    null,
  );
  const [originalMessageOpen, setOriginalMessageOpen] = useState(false);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<UploadedImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const {
    mutateAsync: generateDraft,
    isPending,
    error,
    reset,
  } = useGenerateTaskIntakeDraft();

  useEffect(() => {
    if (!open) {
      return;
    }

    setRawMessage("");
    setDraft(null);
    setOriginalMessageOpen(false);
    setImageError(null);
    setPreviewImage(null);
    setUploadedImages((current) => {
      for (const img of current) {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl);
      }
      return [];
    });
    reset();
  }, [open, reset]);

  const canGenerate = Boolean(rawMessage.trim() || uploadedImages.length > 0);

  const applyImageFiles = useCallback(
    async (files: File[]) => {
      const remaining = MAX_IMAGES - uploadedImages.length;
      if (remaining <= 0) {
        setImageError(
          `Maximum ${MAX_IMAGES} screenshots allowed. Remove one to add another.`,
        );
        return false;
      }

      const toProcess = files.slice(0, remaining);
      const skipped = files.length - toProcess.length;

      const newImages: UploadedImage[] = [];
      let hadError = false;

      for (const file of toProcess) {
        if (
          !ALLOWED_IMAGE_TYPES.includes(
            file.type as (typeof ALLOWED_IMAGE_TYPES)[number],
          )
        ) {
          setImageError("Upload or paste a PNG, JPEG, or WebP screenshot.");
          hadError = true;
          break;
        }

        if (file.size > MAX_IMAGE_BYTES) {
          setImageError("Each screenshot must be 5 MB or smaller.");
          hadError = true;
          break;
        }

        try {
          const { mimeType, data } = await readImageAsBase64(file);
          newImages.push({
            mimeType: mimeType as UploadedImage["mimeType"],
            data,
            previewUrl: URL.createObjectURL(file),
            fileName: file.name || "Pasted screenshot",
            fileSize: file.size,
          });
        } catch {
          setImageError("Could not read one of the selected screenshots.");
          hadError = true;
          break;
        }
      }

      if (newImages.length > 0) {
        setUploadedImages((current) => [...current, ...newImages]);
        setImageError(null);

        if (skipped > 0) {
          setImageError(
            `Only ${MAX_IMAGES} screenshots allowed. ${skipped} screenshot${skipped > 1 ? "s were" : " was"} not added.`,
          );
        }
      }

      return !hadError && newImages.length > 0;
    },
    [uploadedImages.length],
  );

  const handleClipboardImagePaste = useCallback(
    async (
      clipboardData: DataTransfer | null,
      preventDefault: () => void,
    ) => {
      if (isPending || draft) {
        return;
      }

      const clipboardImages = getClipboardImageFiles(clipboardData);
      if (clipboardImages === null) {
        return;
      }

      if (clipboardImages === "unsupported") {
        preventDefault();
        setImageError("Paste a PNG, JPEG, or WebP screenshot.");
        return;
      }

      preventDefault();
      await applyImageFiles(clipboardImages);
    },
    [applyImageFiles, draft, isPending],
  );

  useEffect(() => {
    if (!open || draft) {
      return;
    }

    const handlePaste = (event: globalThis.ClipboardEvent) => {
      const modalContent = modalContentRef.current;
      if (!modalContent?.contains(event.target as Node)) {
        return;
      }

      void handleClipboardImagePaste(
        event.clipboardData,
        () => event.preventDefault(),
      );
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [draft, handleClipboardImagePaste, open]);

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) {
      return;
    }

    await applyImageFiles(files);
  };

  const handleRemoveImage = (index: number) => {
    setUploadedImages((current) => {
      const removed = current[index];
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_, i) => i !== index);
    });
    setImageError(null);
  };

  const handleClose = () => {
    onClose();
  };

  const handleGenerate = async () => {
    if (!canGenerate) {
      return;
    }

    reset();

    try {
      const result = await generateDraft({
        projectId,
        ...(rawMessage.trim() ? { rawMessage: rawMessage.trim() } : {}),
        ...(uploadedImages.length > 0
          ? {
              images: uploadedImages.map((img) => ({
                mimeType: img.mimeType,
                data: img.data,
              })),
            }
          : {}),
      });
      setDraft(result);
    } catch {
      // Error state is handled by the mutation hook.
    }
  };

  const handleApply = () => {
    if (!draft) {
      return;
    }

    onApply({
      title: draft.title,
      description: formatTaskIntakeDescription(draft),
      priority: draft.priority,
      dueDate: parseDueDate(draft.dueDate),
      startDate: parseDueDate(draft.startDate),
    });
    handleClose();
  };

  const handleBack = () => {
    setDraft(null);
    reset();
  };

  const atMaxImages = uploadedImages.length >= MAX_IMAGES;

  return (
    <>
      {/* Fullscreen preview overlay — rendered outside Dialog to avoid clipping */}
      {previewImage && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewImage(null)}
          onKeyDown={(e) => e.key === "Escape" && setPreviewImage(null)}
          role="dialog"
          aria-label="Screenshot preview"
          aria-modal="true"
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-3 -right-3 z-10 rounded-full bg-background border border-border p-1.5 shadow-md hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={previewImage.previewUrl}
              alt={previewImage.fileName}
              className="max-w-full max-h-[80vh] rounded-md object-contain"
            />
            <p className="text-xs text-white/70 truncate max-w-full">
              {previewImage.fileName}
            </p>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border-border bg-card"
          showCloseButton={false}
        >
          <div ref={modalContentRef} className="flex flex-col flex-1 min-h-0">
            <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-0">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                  <MessageSquareText className="h-5 w-5 text-primary" />
                </div>
                <div className="space-y-1.5 text-left">
                  <DialogTitle className="text-xl font-semibold tracking-tight">
                    Create from Client Message
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                    Paste an email thread, upload screenshots, or paste from
                    your clipboard. Kaneo will draft a task for you to review
                    before creating it.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-4">
              {!draft ? (
                <>
                  <div
                    className={cn(
                      "space-y-4 rounded-lg transition-shadow duration-500",
                      isPending && [
                        "kaneo-ai-card",
                        "border border-transparent p-3",
                        "shadow-[0_0_20px_-5px_rgba(103,232,249,0.16),0_0_20px_-5px_rgba(167,139,250,0.18),0_0_20px_-5px_rgba(240,171,252,0.14)]",
                        "dark:shadow-[0_0_24px_-4px_rgba(103,232,249,0.2),0_0_24px_-4px_rgba(167,139,250,0.22),0_0_24px_-4px_rgba(240,171,252,0.18)]",
                      ],
                    )}
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        Client message
                      </p>
                      <Textarea
                        value={rawMessage}
                        onChange={(event) => setRawMessage(event.target.value)}
                        placeholder="Paste the client email or message here..."
                        className="min-h-52"
                        disabled={isPending}
                      />
                      <p className="text-xs text-muted-foreground">
                        Optional when using a screenshot. Include the full
                        message to preserve quotes, links, and context. You can
                        also paste a screenshot with Ctrl+V or Cmd+V anywhere
                        in this dialog.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-foreground">
                          Screenshots
                        </p>
                        {uploadedImages.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {uploadedImages.length}/{MAX_IMAGES}
                          </p>
                        )}
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ALLOWED_IMAGE_TYPES.join(",")}
                          multiple
                          className="hidden"
                          onChange={handleImageSelect}
                          disabled={isPending}
                        />

                        {uploadedImages.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {uploadedImages.map((img, i) => (
                              <div
                                key={img.previewUrl}
                                className="relative group"
                              >
                                <button
                                  type="button"
                                  aria-label={`Preview ${img.fileName}`}
                                  onClick={() =>
                                    !isPending && setPreviewImage(img)
                                  }
                                  disabled={isPending}
                                  className="block rounded-md border border-border overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
                                >
                                  <img
                                    src={img.previewUrl}
                                    alt={img.fileName}
                                    className="h-20 w-auto max-w-[8rem] object-contain bg-background"
                                  />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Remove ${img.fileName}`}
                                  onClick={() => handleRemoveImage(i)}
                                  disabled={isPending}
                                  className="absolute -top-1.5 -right-1.5 rounded-full bg-background border border-border p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:bg-accent disabled:cursor-not-allowed"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {!atMaxImages && (
                          <div className="space-y-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isPending}
                              className="border-border text-foreground hover:bg-accent"
                            >
                              <ImagePlus className="h-4 w-4 mr-2" />
                              {uploadedImages.length > 0
                                ? "Add another screenshot"
                                : "Upload screenshot"}
                            </Button>
                            {uploadedImages.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                Upload or paste a screenshot (Ctrl+V / Cmd+V).
                              </p>
                            )}
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                          PNG, JPEG, or WebP up to 5 MB each. Up to{" "}
                          {MAX_IMAGES} screenshots. Screenshots are analyzed by
                          Gemini and are not stored.
                        </p>
                      </div>
                    </div>

                    {isPending && (
                      <div className="flex items-start gap-2.5 pt-1">
                        <Sparkles
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-violet-400 dark:text-violet-300 motion-safe:animate-pulse"
                        />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">
                            Generating task draft…
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Reading the client message and preparing a
                            structured task.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {imageError && (
                    <Alert variant="error">
                      <AlertCircle />
                      <AlertTitle>Screenshot issue</AlertTitle>
                      <AlertDescription>{imageError}</AlertDescription>
                    </Alert>
                  )}

                  {error && (
                    <Alert variant="error">
                      <AlertCircle />
                      <AlertTitle>Generation failed</AlertTitle>
                      <AlertDescription>{error.message}</AlertDescription>
                    </Alert>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <ReviewSection label="Generated title">
                    <p className="text-base font-semibold text-foreground">
                      {draft.title}
                    </p>
                  </ReviewSection>

                  <ReviewSection label="Summary">
                    <p className="whitespace-pre-wrap text-foreground">
                      {draft.summary}
                    </p>
                  </ReviewSection>

                  {draft.requestedChanges.length > 0 && (
                    <ReviewSection label="Requested changes">
                      <ul className="list-disc pl-5 space-y-1 text-foreground">
                        {draft.requestedChanges.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </ReviewSection>
                  )}

                  {draft.workerNotes.length > 0 && (
                    <ReviewSection label="Notes for worker">
                      <ul className="list-disc pl-5 space-y-1 text-foreground">
                        {draft.workerNotes.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </ReviewSection>
                  )}

                  {draft.missingInfo.length > 0 && (
                    <ReviewSection label="Missing info">
                      <ul className="list-disc pl-5 space-y-1 text-foreground">
                        {draft.missingInfo.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </ReviewSection>
                  )}

                  <Collapsible
                    open={originalMessageOpen}
                    onOpenChange={setOriginalMessageOpen}
                    className="rounded-lg border border-border bg-muted/20"
                  >
                    <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-accent/50 transition-colors">
                      <span>Original client message</span>
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          originalMessageOpen && "rotate-180",
                        )}
                      />
                    </CollapsibleTrigger>
                    <CollapsiblePanel className="border-t border-border px-4 py-3">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {draft.originalClientMessage}
                      </p>
                    </CollapsiblePanel>
                  </Collapsible>
                </div>
              )}
            </div>

            <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4 gap-2">
              {!draft ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleClose}
                    disabled={isPending}
                    className="border-border text-foreground hover:bg-accent"
                  >
                    Cancel
                  </Button>
                  <AiGenerateButton
                    canGenerate={canGenerate}
                    isPending={isPending}
                    onClick={handleGenerate}
                  />
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    className="border-border text-foreground hover:bg-accent mr-auto"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={handleClose}
                    variant="outline"
                    size="sm"
                    className="border-border text-foreground hover:bg-accent"
                  >
                    Cancel
                  </Button>
                  <Button type="button" size="sm" onClick={handleApply}>
                    Apply to Task
                  </Button>
                </>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ClientMessageIntakeModal;
