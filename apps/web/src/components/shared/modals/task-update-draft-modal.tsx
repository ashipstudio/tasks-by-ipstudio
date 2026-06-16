import {
  AlertCircle,
  Check,
  ImagePlus,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { GenerateTaskUpdateDraftResponse } from "@/fetchers/task/generate-task-update-draft";
import useGenerateTaskUpdateDraft from "@/hooks/mutations/task/use-generate-task-update-draft";
import { useUpdateTaskDescription } from "@/hooks/mutations/task/use-update-task-description";
import { useUpdateTaskDueDate } from "@/hooks/mutations/task/use-update-task-due-date";
import { useUpdateTaskPriority } from "@/hooks/mutations/task/use-update-task-status-priority";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type UploadedImage = {
  mimeType: (typeof ALLOWED_IMAGE_TYPES)[number];
  data: string;
  previewUrl: string;
  fileName: string;
};

type TaskUpdateDraftModalProps = {
  open: boolean;
  onClose: () => void;
  taskId: string;
  onUseAsComment: (text: string) => void;
};

function getClipboardImageFiles(
  clipboardData: DataTransfer | null,
): File[] | null | "unsupported" {
  if (!clipboardData) return null;

  const files: File[] = [];
  let hasUnsupportedImage = false;

  for (const item of clipboardData.items) {
    if (item.kind !== "file") continue;

    if (
      ALLOWED_IMAGE_TYPES.includes(
        item.type as (typeof ALLOWED_IMAGE_TYPES)[number],
      )
    ) {
      const file = item.getAsFile();
      if (file) files.push(file);
    } else if (item.type.startsWith("image/")) {
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

function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;

  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;

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
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {action}
      </div>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  return (
    <ul className="list-disc pl-5 space-y-1 text-foreground">
      {items.map((item) => (
        <li key={item} className="whitespace-pre-wrap">
          {item}
        </li>
      ))}
    </ul>
  );
}

function AiGenerateButton({
  canGenerate,
  isPending,
  onClick,
}: {
  canGenerate: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const hasAiStyle = canGenerate;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!canGenerate || isPending}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent font-medium outline-none transition-all sm:text-sm",
        "h-8 px-[calc(--spacing(2.5)-1px)] text-sm text-foreground",
        hasAiStyle &&
          !isPending && [
            "kaneo-ai-btn",
            "shadow-[0_0_8px_-3px_rgba(103,232,249,0.25),0_0_8px_-3px_rgba(167,139,250,0.25),0_0_8px_-3px_rgba(240,171,252,0.2)]",
            "hover:-translate-y-px",
          ],
        hasAiStyle && isPending && "kaneo-ai-btn opacity-80",
        (!canGenerate || isPending) && "cursor-not-allowed opacity-50",
      )}
    >
      {isPending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles
          aria-hidden
          className={cn(
            "size-3.5 text-violet-400 dark:text-violet-300",
            hasAiStyle && "motion-safe:animate-pulse",
          )}
        />
      )}
      <span>{isPending ? "Generating…" : "Generate Proposal"}</span>
    </button>
  );
}

function ProposalReview({
  proposal,
  task,
  onUseAsComment,
  onClose,
}: {
  proposal: GenerateTaskUpdateDraftResponse;
  task: Task;
  onUseAsComment: (text: string) => void;
  onClose: () => void;
}) {
  const { mutateAsync: updateDescription, isPending: isUpdatingDescription } =
    useUpdateTaskDescription();
  const { mutateAsync: updatePriority, isPending: isUpdatingPriority } =
    useUpdateTaskPriority();
  const { mutateAsync: updateDueDate, isPending: isUpdatingDueDate } =
    useUpdateTaskDueDate();

  const [appliedDescription, setAppliedDescription] = useState(false);
  const [appliedComment, setAppliedComment] = useState(false);
  const [appliedPriority, setAppliedPriority] = useState(false);
  const [appliedDueDate, setAppliedDueDate] = useState(false);

  const handleAppendDescription = async () => {
    const append = proposal.suggestedDescriptionAppend.trim();
    if (!append) {
      toast.error("No description append was suggested.");
      return;
    }

    const current = task.description?.trim() ?? "";
    const nextDescription = current ? `${current}\n\n${append}` : append;

    try {
      await updateDescription({
        ...task,
        description: nextDescription,
      });
      setAppliedDescription(true);
      toast.success("Update appended to task description.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to update task description.",
      );
    }
  };

  const handleUseAsComment = () => {
    const text = proposal.suggestedComment.trim();
    if (!text) {
      toast.error("No suggested comment was provided.");
      return;
    }

    onUseAsComment(text);
    setAppliedComment(true);
    toast.success(
      "Suggested comment added to the composer. Review before posting.",
    );
    onClose();
  };

  const handleApplyPriority = async () => {
    if (!proposal.suggestedPriority) return;

    try {
      await updatePriority({
        ...task,
        priority: proposal.suggestedPriority,
      });
      setAppliedPriority(true);
      toast.success("Priority updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update priority.",
      );
    }
  };

  const handleApplyDueDate = async () => {
    const dueDate = parseIsoDate(proposal.suggestedDueDate);
    if (!dueDate) {
      toast.error("Suggested due date is invalid.");
      return;
    }

    try {
      await updateDueDate({
        ...task,
        dueDate,
      });
      setAppliedDueDate(true);
      toast.success("Due date updated.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update due date.",
      );
    }
  };

  const confidencePercent = Math.round(proposal.confidence * 100);

  return (
    <div className="space-y-3">
      <ReviewSection label="Latest update summary">
        <p className="whitespace-pre-wrap text-foreground">
          {proposal.latestUpdateSummary}
        </p>
      </ReviewSection>

      {proposal.newRequestedChanges.length > 0 && (
        <ReviewSection label="New requested changes">
          <BulletList items={proposal.newRequestedChanges} />
        </ReviewSection>
      )}

      {proposal.changedRequirements.length > 0 && (
        <ReviewSection label="Changed requirements">
          <BulletList items={proposal.changedRequirements} />
        </ReviewSection>
      )}

      {proposal.supersededRequests.length > 0 && (
        <ReviewSection label="Superseded requests">
          <BulletList items={proposal.supersededRequests} />
        </ReviewSection>
      )}

      {proposal.missingInfo.length > 0 && (
        <ReviewSection label="Missing info">
          <BulletList items={proposal.missingInfo} />
        </ReviewSection>
      )}

      {proposal.suggestedComment.trim() && (
        <ReviewSection
          label="Suggested comment"
          action={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={appliedComment}
              onClick={handleUseAsComment}
            >
              {appliedComment ? (
                <>
                  <Check className="size-3 mr-1" />
                  Added
                </>
              ) : (
                "Use as comment"
              )}
            </Button>
          }
        >
          <p className="whitespace-pre-wrap text-foreground">
            {proposal.suggestedComment}
          </p>
        </ReviewSection>
      )}

      {proposal.suggestedDescriptionAppend.trim() && (
        <ReviewSection
          label="Suggested description append"
          action={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={appliedDescription || isUpdatingDescription}
              onClick={() => void handleAppendDescription()}
            >
              {appliedDescription ? (
                <>
                  <Check className="size-3 mr-1" />
                  Appended
                </>
              ) : isUpdatingDescription ? (
                <>
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Appending…
                </>
              ) : (
                "Append to description"
              )}
            </Button>
          }
        >
          <pre className="whitespace-pre-wrap font-sans text-foreground text-sm">
            {proposal.suggestedDescriptionAppend}
          </pre>
        </ReviewSection>
      )}

      {proposal.suggestedPriority && (
        <ReviewSection
          label="Suggested priority"
          action={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={appliedPriority || isUpdatingPriority}
              onClick={() => void handleApplyPriority()}
            >
              {appliedPriority ? (
                <>
                  <Check className="size-3 mr-1" />
                  Applied
                </>
              ) : isUpdatingPriority ? (
                <>
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Applying…
                </>
              ) : (
                "Apply priority"
              )}
            </Button>
          }
        >
          <p className="text-foreground">
            {getPriorityLabel(proposal.suggestedPriority)}
          </p>
        </ReviewSection>
      )}

      {proposal.suggestedDueDate && (
        <ReviewSection
          label="Suggested due date"
          action={
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={appliedDueDate || isUpdatingDueDate}
              onClick={() => void handleApplyDueDate()}
            >
              {appliedDueDate ? (
                <>
                  <Check className="size-3 mr-1" />
                  Applied
                </>
              ) : isUpdatingDueDate ? (
                <>
                  <Loader2 className="size-3 mr-1 animate-spin" />
                  Applying…
                </>
              ) : (
                "Apply due date"
              )}
            </Button>
          }
        >
          <p className="text-foreground">
            {formatDateShort(
              parseIsoDate(proposal.suggestedDueDate) ??
                proposal.suggestedDueDate,
            )}
          </p>
        </ReviewSection>
      )}

      <p className="text-xs text-muted-foreground">
        Confidence: {confidencePercent}%
      </p>
    </div>
  );
}

function TaskUpdateDraftModal({
  open,
  onClose,
  taskId,
  onUseAsComment,
}: TaskUpdateDraftModalProps) {
  const { data: task } = useGetTask(taskId);
  const [rawMessage, setRawMessage] = useState("");
  const [uploadedImage, setUploadedImage] = useState<UploadedImage | null>(
    null,
  );
  const [imageError, setImageError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [proposal, setProposal] =
    useState<GenerateTaskUpdateDraftResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const {
    mutateAsync: generateProposal,
    isPending,
    error,
    reset,
  } = useGenerateTaskUpdateDraft();

  useEffect(() => {
    if (!open) return;

    setRawMessage("");
    setImageError(null);
    setPreviewOpen(false);
    setProposal(null);
    setUploadedImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    reset();
  }, [open, reset]);

  const canGenerate = Boolean(rawMessage.trim() || uploadedImage);

  const applyImageFile = useCallback(async (file: File) => {
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
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return {
          mimeType: mimeType as UploadedImage["mimeType"],
          data,
          previewUrl: URL.createObjectURL(file),
          fileName: file.name || "Pasted screenshot",
        };
      });
      setImageError(null);
      return true;
    } catch {
      setImageError("Could not read the selected screenshot.");
      return false;
    }
  }, []);

  const handleClipboardImagePaste = useCallback(
    async (clipboardData: DataTransfer | null, preventDefault: () => void) => {
      if (isPending || proposal) return;

      const clipboardImages = getClipboardImageFiles(clipboardData);
      if (clipboardImages === null) return;

      if (clipboardImages === "unsupported") {
        preventDefault();
        setImageError("Paste a PNG, JPEG, or WebP screenshot.");
        return;
      }

      preventDefault();
      const first = clipboardImages[0];
      if (first) await applyImageFile(first);
    },
    [applyImageFile, isPending, proposal],
  );

  useEffect(() => {
    if (!open || proposal) return;

    const handlePaste = (event: globalThis.ClipboardEvent) => {
      const modalContent = modalContentRef.current;
      if (!modalContent?.contains(event.target as Node)) return;

      void handleClipboardImagePaste(event.clipboardData, () =>
        event.preventDefault(),
      );
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handleClipboardImagePaste, open, proposal]);

  const handleImageSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await applyImageFile(file);
  };

  const handleRemoveImage = () => {
    setUploadedImage((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
    setImageError(null);
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;

    reset();

    try {
      const result = await generateProposal({
        taskId,
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
      setProposal(result);
    } catch {
      // Error handled by mutation hook.
    }
  };

  const handleBack = () => {
    setProposal(null);
    reset();
  };

  if (!task) return null;

  return (
    <>
      {previewOpen && uploadedImage && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80"
          onClick={() => setPreviewOpen(false)}
          onKeyDown={(e) => e.key === "Escape" && setPreviewOpen(false)}
          role="dialog"
          aria-label="Screenshot preview"
          aria-modal="true"
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setPreviewOpen(false)}
              className="absolute -top-3 -right-3 z-10 rounded-full bg-background border border-border p-1.5 shadow-md hover:bg-accent transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={uploadedImage.previewUrl}
              alt={uploadedImage.fileName}
              className="max-w-full max-h-[80vh] rounded-md object-contain"
            />
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border-border bg-card"
          showCloseButton={false}
        >
          <div ref={modalContentRef} className="flex flex-col flex-1 min-h-0">
            <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-0">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                  <MessageSquarePlus className="h-5 w-5 text-primary" />
                </div>
                <div className="space-y-1.5 text-left">
                  <DialogTitle className="text-xl font-semibold tracking-tight">
                    Update with AI
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                    Paste a new client update. Kaneo will compare it against
                    this task and suggest changes for you to review and apply
                    manually.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-4">
              {!proposal ? (
                <>
                  <div
                    className={cn(
                      "space-y-4 rounded-lg transition-shadow duration-500",
                      isPending && [
                        "kaneo-ai-card border border-transparent p-3",
                        "shadow-[0_0_20px_-5px_rgba(103,232,249,0.16),0_0_20px_-5px_rgba(167,139,250,0.18)]",
                      ],
                    )}
                  >
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        Client update
                      </p>
                      <Textarea
                        value={rawMessage}
                        onChange={(event) => setRawMessage(event.target.value)}
                        placeholder="Paste the latest client email or message here..."
                        className="min-h-44"
                        disabled={isPending}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">
                        Screenshot (optional)
                      </p>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALLOWED_IMAGE_TYPES.join(",")}
                        className="hidden"
                        onChange={(event) => void handleImageSelect(event)}
                      />

                      {uploadedImage ? (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setPreviewOpen(true)}
                            className="relative h-16 w-16 overflow-hidden rounded-md border border-border"
                          >
                            <img
                              src={uploadedImage.previewUrl}
                              alt={uploadedImage.fileName}
                              className="h-full w-full object-cover"
                            />
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground truncate">
                              {uploadedImage.fileName}
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={handleRemoveImage}
                              disabled={isPending}
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={isPending}
                        >
                          <ImagePlus className="h-4 w-4 mr-2" />
                          Upload screenshot
                        </Button>
                      )}

                      <p className="text-xs text-muted-foreground">
                        One PNG, JPEG, or WebP up to 5 MB. Paste with Ctrl+V /
                        Cmd+V. Not stored on the server.
                      </p>
                    </div>

                    {isPending && (
                      <div className="flex items-start gap-2.5 pt-1">
                        <Sparkles
                          aria-hidden
                          className="mt-0.5 size-4 shrink-0 text-violet-400 motion-safe:animate-pulse"
                        />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium text-foreground">
                            Generating update proposal…
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Comparing the client update against this task.
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
                <ProposalReview
                  proposal={proposal}
                  task={task}
                  onUseAsComment={onUseAsComment}
                  onClose={onClose}
                />
              )}
            </div>

            <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4 gap-2">
              {!proposal ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClose}
                    disabled={isPending}
                  >
                    Cancel
                  </Button>
                  <AiGenerateButton
                    canGenerate={canGenerate}
                    isPending={isPending}
                    onClick={() => void handleGenerate()}
                  />
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleBack}
                    className="mr-auto"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onClose}
                  >
                    Close
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

export default TaskUpdateDraftModal;
