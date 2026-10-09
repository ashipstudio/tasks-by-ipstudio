import { FileText, Paperclip } from "lucide-react";
import { useMemo, useState } from "react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { formatDateShort } from "@/lib/format";
import { toast } from "@/lib/toast";
import {
  downloadAttachment,
  formatBytes,
  normalizeAttachmentUrl,
} from "./extensions/attachment-card";

type CommentLike = {
  id: string;
  type: string;
  content: string | null;
  createdAt: string | Date;
};

type TaskAttachment = {
  kind: "image" | "file";
  url: string;
  name: string;
  mimeType: string;
  size: number;
  source: string;
};

const MARKDOWN_IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g;

/**
 * Finds images (`<img>` and markdown images) and file attachments
 * (`<kaneo-attachment>`) in stored description/comment markdown.
 */
function extractAttachments(text: string, source: string): TaskAttachment[] {
  if (!text) return [];

  const found: TaskAttachment[] = [];
  const doc = new DOMParser().parseFromString(text, "text/html");

  for (const img of doc.querySelectorAll("img[src]")) {
    const alt = img.getAttribute("alt")?.trim();
    found.push({
      kind: "image",
      url: img.getAttribute("src") ?? "",
      name: alt && alt !== "image" ? alt : "Image",
      mimeType: "",
      size: 0,
      source,
    });
  }

  for (const file of doc.querySelectorAll(
    "kaneo-attachment[url], span[data-type='attachment-card'][data-url]",
  )) {
    const mimeType =
      file.getAttribute("mime-type") ?? file.getAttribute("data-mime-type");
    found.push({
      kind: mimeType?.startsWith("image/") ? "image" : "file",
      url: file.getAttribute("url") ?? file.getAttribute("data-url") ?? "",
      name:
        file.getAttribute("filename") ??
        file.getAttribute("data-filename") ??
        "Attachment",
      mimeType: mimeType ?? "",
      size: Number(
        file.getAttribute("size") ?? file.getAttribute("data-size") ?? 0,
      ),
      source,
    });
  }

  for (const match of text.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    found.push({
      kind: "image",
      url: match[2] ?? "",
      name: match[1]?.trim() || "Image",
      mimeType: "",
      size: 0,
      source,
    });
  }

  return found.filter((item) => item.url);
}

function getExtension(name: string): string {
  const extension = name.split(".").pop();
  return extension && extension !== name ? extension.toUpperCase() : "FILE";
}

type TaskAttachmentsProps = {
  taskId: string;
  comments: CommentLike[];
};

/** Gmail-style strip of every image and file in the description and comments. */
export default function TaskAttachments({
  taskId,
  comments,
}: TaskAttachmentsProps) {
  const { data: task } = useGetTask(taskId);
  const [previewImage, setPreviewImage] = useState<TaskAttachment | null>(null);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

  const attachments = useMemo(() => {
    const items = [
      ...extractAttachments(task?.description ?? "", "Description"),
      // Activities arrive newest-first; list comment attachments oldest-first.
      ...[...comments]
        .reverse()
        .filter((item) => item.type === "comment" && item.content)
        .flatMap((item) =>
          extractAttachments(
            item.content ?? "",
            `Comment · ${formatDateShort(new Date(item.createdAt))}`,
          ),
        ),
    ];

    // The same file can be referenced more than once; show it once.
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [task?.description, comments]);

  if (attachments.length === 0) return null;

  const handleDownload = async (file: TaskAttachment) => {
    if (downloadingUrl) return;
    setDownloadingUrl(file.url);
    try {
      await downloadAttachment(normalizeAttachmentUrl(file.url), file.name);
    } catch (error) {
      console.error("Failed to download attachment:", error);
      toast.error("Could not download this attachment");
    } finally {
      setDownloadingUrl(null);
    }
  };

  return (
    <section className="space-y-2 border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground/70">
        <Paperclip className="size-3.5" />
        {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
      </p>

      <ul className="flex flex-wrap gap-2">
        {attachments.map((item) => (
          <li key={item.url} className="w-36">
            <button
              type="button"
              onClick={(event) => {
                // Without this, the opening click also reaches the new
                // dialog's outside-press handler and closes it immediately.
                event.stopPropagation();
                event.preventDefault();
                if (item.kind === "image") {
                  setPreviewImage(item);
                } else {
                  void handleDownload(item);
                }
              }}
              disabled={downloadingUrl === item.url}
              title={
                item.kind === "image"
                  ? `Preview ${item.name}`
                  : `Download ${item.name}`
              }
              className="group block w-full overflow-hidden rounded-lg border border-border bg-card text-left transition-colors hover:border-ring/60 disabled:opacity-60"
            >
              <div className="flex h-24 items-center justify-center bg-muted/40">
                {item.kind === "image" ? (
                  <img
                    src={normalizeAttachmentUrl(item.url)}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-muted-foreground">
                    <FileText className="size-7" />
                    <span className="text-[10px] font-semibold">
                      {getExtension(item.name)}
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-0.5 px-2 py-1.5">
                <p className="truncate text-xs font-medium text-foreground">
                  {item.name}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {item.kind === "file" && item.size > 0
                    ? `${formatBytes(item.size)} · ${item.source}`
                    : item.source}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => !open && setPreviewImage(null)}
      >
        <DialogPopup
          className="max-w-6xl border-0 bg-transparent p-0 shadow-none before:hidden"
          showCloseButton={false}
          bottomStickOnMobile={false}
        >
          {previewImage && (
            <div className="flex max-h-[90vh] items-center justify-center p-4">
              <img
                src={normalizeAttachmentUrl(previewImage.url)}
                alt={previewImage.name}
                className="max-h-[85vh] max-w-[92vw] rounded-xl border border-white/12 bg-black/30 object-contain shadow-2xl"
              />
            </div>
          )}
        </DialogPopup>
      </Dialog>
    </section>
  );
}
