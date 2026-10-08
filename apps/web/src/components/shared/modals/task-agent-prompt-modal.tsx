import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/public-project/markdown-renderer";
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
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs";
import type { GenerateTaskAgentPromptResponse } from "@/fetchers/task/generate-task-agent-prompt";
import useGenerateTaskAgentPrompt from "@/hooks/mutations/task/use-generate-task-agent-prompt";
import { toast } from "@/lib/toast";

type TaskAgentPromptModalProps = {
  open: boolean;
  onClose: () => void;
  taskId: string;
};

function TaskAgentPromptModal({
  open,
  onClose,
  taskId,
}: TaskAgentPromptModalProps) {
  const [result, setResult] = useState<GenerateTaskAgentPromptResponse | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  // Bumped on every open and every run, so a response that arrives after the
  // modal was closed/reopened (or re-run) is ignored.
  const requestIdRef = useRef(0);

  const {
    mutateAsync: generatePrompt,
    isPending,
    error,
    reset,
  } = useGenerateTaskAgentPrompt();

  const generate = useCallback(async () => {
    reset();
    setCopied(false);
    const requestId = ++requestIdRef.current;

    try {
      const response = await generatePrompt(taskId);
      if (requestId !== requestIdRef.current) return;
      setResult(response);
    } catch {
      // Error shown from mutation state.
    }
  }, [generatePrompt, reset, taskId]);

  // Generate on first open only; reopening shows the last brief until the
  // user asks for a new one with Regenerate.
  useEffect(() => {
    if (!open) {
      requestIdRef.current += 1;
      return;
    }

    setCopied(false);
    if (!result) void generate();
  }, [open, generate, result]);

  const handleCopy = async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      toast.success("Agent prompt copied to clipboard.");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border-border bg-card"
        showCloseButton={false}
      >
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-0">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-1.5 text-left">
              <DialogTitle className="text-xl font-semibold tracking-tight">
                Task for Agent
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
                A brief built from this task's description, comments, updates
                and images. Review it, then paste it into your coding agent.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-4">
          {isPending && (
            <div className="kaneo-ai-card flex items-start gap-2.5 rounded-lg border border-transparent p-4">
              <Sparkles
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-violet-400 motion-safe:animate-pulse"
              />
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  Reading the task…
                </p>
                <p className="text-xs text-muted-foreground">
                  Going through the description, comments and screenshots. This
                  can take up to a minute for large tasks.
                </p>
              </div>
            </div>
          )}

          {error && !isPending && (
            <Alert variant="error">
              <AlertCircle />
              <AlertTitle>Generation failed</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          )}

          {result && !isPending && (
            <>
              <Tabs defaultValue="preview">
                <TabsList>
                  <TabsTab value="preview">Preview</TabsTab>
                  <TabsTab value="markdown">Markdown</TabsTab>
                </TabsList>
                <TabsPanel value="preview" className="pt-3">
                  <div className="rounded-lg border border-border bg-background p-4">
                    <MarkdownRenderer content={result.markdown} />
                  </div>
                </TabsPanel>
                <TabsPanel value="markdown" className="pt-3">
                  <pre className="rounded-lg border border-border bg-background p-4 text-xs whitespace-pre-wrap break-words font-mono text-foreground">
                    {result.markdown}
                  </pre>
                </TabsPanel>
              </Tabs>
              <p className="text-xs text-muted-foreground">
                {result.imageCount === 1
                  ? "1 image was read."
                  : `${result.imageCount} images were read.`}
                {result.skippedImageCount > 0 &&
                  ` ${result.skippedImageCount} could not be included (unsupported type or size limit).`}
              </p>
            </>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 border-t border-border bg-background px-6 py-4 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void generate()}
            disabled={isPending}
            className="mr-auto"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Regenerate
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleCopy()}
            disabled={!result || isPending}
          >
            {copied ? (
              <Check className="h-4 w-4 mr-2" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {copied ? "Copied" : "Copy for Agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default TaskAgentPromptModal;
