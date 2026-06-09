import {
  AlertCircle,
  ChevronDown,
  ImagePlus,
  Loader2,
  MessageSquareText,
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
};

type ClientMessageIntakeModalProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onApply: (draft: AppliedIntakeDraft) => void;
};

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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

function getClipboardImageFile(
  clipboardData: DataTransfer | null,
): File | null | "unsupported" {
  if (!clipboardData) {
    return null;
  }

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
      return item.getAsFile();
    }

    hasUnsupportedImage = true;
  }

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

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);
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
    setUploadedImage((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
    });
    reset();
  }, [open, reset]);

  const canGenerate = Boolean(rawMessage.trim() || uploadedImage);

  const applyImageFile = useCallback(
    async (file: File, displayName: string) => {
      if (
        !ALLOWED_IMAGE_TYPES.includes(
          file.type as (typeof ALLOWED_IMAGE_TYPES)[number],
        )
      ) {
        setImageError("Upload or paste a PNG, JPEG, or WebP screenshot.");
        return false;
      }

      if (file.size > MAX_IMAGE_BYTES) {
        setImageError("Screenshot must be 5 MB or smaller.");
        return false;
      }

      try {
        const { mimeType, data } = await readImageAsBase64(file);
        setUploadedImage((current) => {
          if (current?.previewUrl) {
            URL.revokeObjectURL(current.previewUrl);
          }

          return {
            mimeType: mimeType as UploadedImage["mimeType"],
            data,
            previewUrl: URL.createObjectURL(file),
            fileName: displayName,
            fileSize: file.size,
          };
        });
        setImageError(null);
        return true;
      } catch {
        setImageError("Could not read the selected screenshot.");
        return false;
      }
    },
    [],
  );

  const handleClipboardImagePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (isPending || draft) {
        return;
      }

      const clipboardImage = getClipboardImageFile(event.clipboardData);
      if (clipboardImage === null) {
        return;
      }

      if (clipboardImage === "unsupported") {
        event.preventDefault();
        setImageError("Paste a PNG, JPEG, or WebP screenshot.");
        return;
      }

      event.preventDefault();
      await applyImageFile(clipboardImage, "Pasted screenshot");
    },
    [applyImageFile, draft, isPending],
  );

  useEffect(() => {
    if (!open || draft) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      const modalContent = modalContentRef.current;
      if (!modalContent?.contains(event.target as Node)) {
        return;
      }

      void handleClipboardImagePaste(event);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [draft, handleClipboardImagePaste, open]);

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await applyImageFile(file, file.name);
  };

  const handleRemoveImage = () => {
    setUploadedImage((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }
      return null;
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
        ...(uploadedImage
          ? {
              image: {
                mimeType: uploadedImage.mimeType,
                data: uploadedImage.data,
              },
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
    });
    handleClose();
  };

  const handleBack = () => {
    setDraft(null);
    reset();
  };

  return (
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
                  Paste an email thread, upload a screenshot, or paste a
                  screenshot from your clipboard. Kaneo will draft a task for
                  you to review before creating it.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-4">
            {!draft ? (
              <>
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
                    Optional when using a screenshot. Include the full message
                    to preserve quotes, links, and context. You can also paste a
                    screenshot with Ctrl+V or Cmd+V anywhere in this dialog.
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Screenshot
                  </p>
                  <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ALLOWED_IMAGE_TYPES.join(",")}
                      className="hidden"
                      onChange={handleImageSelect}
                      disabled={isPending}
                    />

                    {uploadedImage ? (
                      <div className="flex items-start gap-3">
                        <img
                          src={uploadedImage.previewUrl}
                          alt="Uploaded screenshot preview"
                          className="h-24 w-auto max-w-full rounded-md border border-border object-contain bg-background"
                        />
                        <div className="min-w-0 flex-1 space-y-2">
                          <p className="truncate text-sm text-foreground">
                            {uploadedImage.fileName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {uploadedImage.mimeType} ·{" "}
                            {formatFileSize(uploadedImage.fileSize)}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleRemoveImage}
                            disabled={isPending}
                            className="border-border text-foreground hover:bg-accent"
                          >
                            <X className="h-3.5 w-3.5 mr-1.5" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ) : (
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
                          Upload screenshot
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          Upload or paste a screenshot (Ctrl+V / Cmd+V).
                        </p>
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      PNG, JPEG, or WebP up to 5 MB. Screenshots are analyzed by
                      Gemini and are not stored.
                    </p>
                  </div>
                </div>

                {imageError && (
                  <Alert variant="error">
                    <AlertCircle />
                    <AlertTitle>Invalid screenshot</AlertTitle>
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
                <Button
                  type="button"
                  size="sm"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isPending}
                  className="gap-2"
                >
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Generate Draft
                </Button>
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
  );
}

export default ClientMessageIntakeModal;
