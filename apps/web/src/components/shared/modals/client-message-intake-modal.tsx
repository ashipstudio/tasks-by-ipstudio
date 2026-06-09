import {
  AlertCircle,
  ChevronDown,
  Loader2,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
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
      <DialogContent
        className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden border-border bg-card"
        showCloseButton={false}
      >
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
                Paste an email thread or client request. Kaneo will draft a task
                for you to review before creating it.
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
                  Include the full message so the draft can preserve quotes,
                  links, and context.
                </p>
              </div>

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
                disabled={!rawMessage.trim() || isPending}
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
      </DialogContent>
    </Dialog>
  );
}

export default ClientMessageIntakeModal;
