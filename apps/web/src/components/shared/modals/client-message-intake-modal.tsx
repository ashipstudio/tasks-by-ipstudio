import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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

function formatBulletList(items: string[]): string {
  if (items.length === 0) {
    return "";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function formatTaskIntakeDescription(
  draft: GenerateTaskIntakeDraftResponse,
): string {
  const sections = [
    `## Summary\n\n${draft.summary}`,
    `## Requested Changes\n\n${formatBulletList(draft.requestedChanges)}`,
    `## Notes for Worker\n\n${formatBulletList(draft.workerNotes)}`,
  ];

  if (draft.missingInfo.length > 0) {
    sections.push(`## Missing Info\n\n${formatBulletList(draft.missingInfo)}`);
  }

  sections.push(`## Original Client Message\n\n${draft.originalClientMessage}`);

  return sections.join("\n\n");
}

function parseDueDate(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
    reset();
  }, [open, reset]);

  const handleClose = () => {
    onClose();
  };

  const handleGenerate = async () => {
    if (!rawMessage.trim()) {
      return;
    }

    reset();

    try {
      const result = await generateDraft({
        projectId,
        rawMessage: rawMessage.trim(),
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
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Create from Client Message</DialogTitle>
          <DialogDescription>
            Paste an email thread or client request. Kaneo will draft a task
            title and description for you to review before creating the task.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1">
          {!draft ? (
            <>
              <Textarea
                value={rawMessage}
                onChange={(event) => setRawMessage(event.target.value)}
                placeholder="Paste the client email or message here..."
                className="min-h-48"
                disabled={isPending}
              />

              {error && (
                <Alert variant="error">
                  <AlertCircle />
                  <AlertTitle>Generation failed</AlertTitle>
                  <AlertDescription>{error.message}</AlertDescription>
                </Alert>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Generated title
                </p>
                <p className="text-base font-semibold text-foreground">
                  {draft.title}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Summary
                </p>
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {draft.summary}
                </p>
              </div>

              {draft.requestedChanges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Requested changes
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {draft.requestedChanges.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draft.workerNotes.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Notes for worker
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {draft.workerNotes.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draft.missingInfo.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Missing info
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-foreground">
                    {draft.missingInfo.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              <Collapsible
                open={originalMessageOpen}
                onOpenChange={setOriginalMessageOpen}
                className="rounded-lg border border-border"
              >
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent/50">
                  <span>Original client message</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform",
                      originalMessageOpen && "rotate-180",
                    )}
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel className="border-t border-border px-3 py-3">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {draft.originalClientMessage}
                  </p>
                </CollapsiblePanel>
              </Collapsible>
            </div>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 border-t border-border pt-4">
          {!draft ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={!rawMessage.trim() || isPending}
                className="gap-2"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Generate Draft
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button type="button" onClick={handleClose} variant="ghost">
                Cancel
              </Button>
              <Button type="button" onClick={handleApply}>
                Apply to Task
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ClientMessageIntakeModal;
