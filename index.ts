/**
 * pi-markdown-extras
 *
 * Enhances chat markdown handling:
 * - GitHub-style alerts ([!NOTE], [!WARNING], [!IMPORTANT], [!TIP], [!CAUTION], etc.)
 *   rendered as alert cards.
 * - Tasks rendered inline, exactly where the model wrote them, using Pi's normal
 *   `[ ]` / `[x]` markdown look. Click a task line to toggle it.
 *
 * How the inline task interaction works:
 * Pi's built-in assistant Markdown renderer cannot host mouse regions per line.
 * When an assistant text block contains task items, this extension:
 *   1. hides that block's default rendering with a display-only markdown transformer,
 *   2. stores the block in a durable custom entry, and
 *   3. re-renders the whole block with Pi's normal `Markdown` component (same layout,
 *      headings, lists, code blocks) wrapped in a mouse region that toggles the task
 *      line that was clicked.
 * The session and the model context are not modified; only the chat display is.
 */

import { Box, Container, Markdown, MouseRegion, Text, stripTerminalSequences } from "@earendil-works/pi-tui";
import type { Component, MarkdownTheme } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ALERT_ENTRY = "md-alert";
const MESSAGE_ENTRY = "md-task-message";
const TASK_STATE_ENTRY = "md-task-state";

const ALERT_TYPES: Record<string, { label: string; icon: string }> = {
  NOTE: { label: "Note", icon: "ℹ" },
  INFO: { label: "Info", icon: "ℹ" },
  TIP: { label: "Tip", icon: "💡" },
  SUCCESS: { label: "Success", icon: "✓" },
  IMPORTANT: { label: "Important", icon: "!" },
  WARNING: { label: "Warning", icon: "⚠" },
  CAUTION: { label: "Caution", icon: "⚠" },
  DANGER: { label: "Danger", icon: "⛔" },
  ERROR: { label: "Error", icon: "⛔" },
  BUG: { label: "Bug", icon: "🐞" },
  EXAMPLE: { label: "Example", icon: "◆" },
  QUOTE: { label: "Quote", icon: "❝" },
};

type AlertData = { type: string; label: string; icon: string; body: string };

type TaskRef = { index: number; checked: boolean; text: string; line: number };
type MessageData = { sourceHash: string; text: string; tasks: TaskRef[] };

const hiddenHashes = new Set<string>();
const taskState = new Map<string, Record<number, boolean>>();
const seenAlerts = new Set<string>();

const TASK_LINE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/;
const TASK_LINE_PARTS = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]\s+(.*)$/;

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
  try { ctx.ui.notify(message, level); } catch {}
}

function getBranch(ctx: ExtensionContext): any[] {
  try { return (ctx.sessionManager.getBranch() as any[]) || []; } catch { return []; }
}

function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function parseAlerts(text: string): AlertData[] {
  const lines = text.split(/\r?\n/);
  const out: AlertData[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*>\s*\[!([A-Z]+)\]\s*(.*)$/);
    if (!m) continue;
    const type = m[1].toUpperCase();
    const meta = ALERT_TYPES[type] || { label: type, icon: "!" };
    const body: string[] = [];
    if (m[2]) body.push(m[2]);
    let j = i + 1;
    while (j < lines.length) {
      const q = lines[j].match(/^\s*>\s?(.*)$/);
      if (!q) break;
      if (/^\s*\[![A-Z]+\]/.test(q[1])) break;
      body.push(q[1]);
      j++;
    }
    out.push({ type, label: meta.label, icon: meta.icon, body: body.join("\n").trim() || "(no content)" });
    i = j - 1;
  }
  return out;
}

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** Parse task items with their source line number. Lines inside code fences are ignored. */
function parseTasks(text: string): TaskRef[] {
  const lines = text.split(/\r?\n/);
  const tasks: TaskRef[] = [];
  let inFence = false;
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(TASK_LINE_PARTS);
    if (!m) continue;
    index++;
    tasks.push({ index, checked: m[2].toLowerCase() === "x", text: m[3].trim(), line: i });
  }
  return tasks;
}

function effectiveChecked(sourceHash: string, task: Pick<TaskRef, "index" | "checked">): boolean {
  const overrides = taskState.get(sourceHash);
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, task.index)) return !!overrides[task.index];
  return task.checked;
}

function setTaskMarker(line: string, checked: boolean): string {
  return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/, (_m, prefix: string) => `${prefix}[${checked ? "x" : " "}]`);
}

/** Apply current toggle state to the source text, preserving every other character. */
function applyTaskStates(data: MessageData): string {
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  if (tasks.length === 0) return data.text;
  const lines = data.text.split(/\r?\n/);
  for (const task of tasks) {
    if (task.line < 0 || task.line >= lines.length) continue;
    lines[task.line] = setTaskMarker(lines[task.line], effectiveChecked(data.sourceHash, task));
  }
  return lines.join("\n");
}

function toggleTask(pi: ExtensionAPI, sourceHash: string, task: Pick<TaskRef, "index" | "checked">, currentChecked: boolean) {
  const next = { ...(taskState.get(sourceHash) || {}), [task.index]: !currentChecked };
  taskState.set(sourceHash, next);
  try {
    pi.appendEntry(TASK_STATE_ENTRY, { sourceHash, overrides: next, at: new Date().toISOString() });
  } catch {}
}

function markdownTheme(theme: any): MarkdownTheme {
  return {
    heading: (text: string) => theme.fg("mdHeading", text),
    link: (text: string) => theme.fg("mdLink", text),
    linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
    code: (text: string) => theme.fg("mdCode", text),
    codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
    quote: (text: string) => theme.fg("mdQuote", text),
    quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
    hr: (text: string) => theme.fg("mdHr", text),
    listBullet: (text: string) => theme.fg("mdListBullet", text),
    bold: (text: string) => theme.bold(text),
    italic: (text: string) => theme.italic(text),
    underline: (text: string) => theme.underline(text),
    strikethrough: (text: string) => theme.strikethrough(text),
  };
}

function renderAlert(entry: any, theme: any): Component {
  const d = (entry?.data || {}) as Partial<AlertData>;
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", `${d.icon || "!"} ${d.label || d.type || "Alert"}`), 0, 0));
  for (const line of String(d.body || "").split("\n").slice(0, 40)) box.addChild(new Text(`  ${line}`, 0, 0));
  return box;
}

/** Return the 1-based task number when the rendered line is a task marker line. */
function taskAtRenderedLine(markdown: Markdown, width: number, y: number): number | null {
  const lines = markdown.render(width);
  if (y < 0 || y >= lines.length) return null;
  const plain = (line: string) => stripTerminalSequences(line);
  if (!TASK_LINE.test(plain(lines[y]))) return null;
  let count = 0;
  for (let i = 0; i <= y; i++) {
    if (TASK_LINE.test(plain(lines[i]))) count++;
  }
  return count || null;
}

/**
 * Entry component that renders a whole assistant text block in the normal
 * markdown style through one Markdown component, so headings, lists, spacing
 * and code blocks look exactly like Pi's default rendering. A click on a task
 * marker line toggles that item.
 */
class TaskMessageView extends Container {
  constructor(private pi: ExtensionAPI, private data: MessageData, private theme: any) {
    super();
  }

  render(width: number): string[] {
    this.clear();
    const mdTheme = markdownTheme(this.theme);
    const markdown = new Markdown(applyTaskStates(this.data), 1, 0, mdTheme);
    const sourceHash = String(this.data.sourceHash || "");

    this.addChild(new MouseRegion(markdown, (event: any) => {
      if (event?.type !== "click" || event?.button !== "left") return undefined;
      const index = taskAtRenderedLine(markdown, event.width || width, event.y);
      if (!index) return undefined;
      const task = (this.data.tasks || []).find((t) => t.index === index);
      if (!task) return undefined;
      toggleTask(this.pi, sourceHash, task, effectiveChecked(sourceHash, task));
      return { handled: true, render: true };
    }));

    return super.render(width);
  }
}

function lastAssistantTaskBlock(ctx: ExtensionContext): { text: string; tasks: TaskRef[]; sourceHash: string } | null {
  const branch = getBranch(ctx);
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type !== "message" || entry?.message?.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) return null;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block?.type !== "text") continue;
      const text = String(block.text || "").trim();
      if (!text) continue;
      const tasks = parseTasks(text);
      if (tasks.length > 0) return { text, tasks, sourceHash: hashText(text) };
    }
    return null;
  }
  return null;
}

export default function markdownExtras(pi: ExtensionAPI) {
  pi.registerEntryRenderer<AlertData>(ALERT_ENTRY, (entry, _options, theme) => renderAlert(entry, theme));
  pi.registerEntryRenderer<MessageData>(MESSAGE_ENTRY, (entry, _options, theme) => {
    const data = (entry?.data || { sourceHash: "", text: "", tasks: [] }) as MessageData;
    return new TaskMessageView(pi, data, theme);
  });

  // Hide the default rendering of blocks that TaskMessageView re-renders with
  // clickable task lines. Display-only: the session and model context stay intact.
  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant") return markdown;
    return hiddenHashes.has(hashText(markdown.trim())) ? "" : markdown;
  });

  pi.on("session_start", (_event, ctx) => {
    hiddenHashes.clear();
    taskState.clear();
    seenAlerts.clear();
    try {
      for (const entry of getBranch(ctx)) {
        if (entry?.type !== "custom") continue;
        const data = entry.data as any;
        if (entry.customType === TASK_STATE_ENTRY && data?.sourceHash) {
          taskState.set(String(data.sourceHash), data.overrides || {});
        } else if (entry.customType === MESSAGE_ENTRY && data?.sourceHash) {
          hiddenHashes.add(String(data.sourceHash));
        }
      }
    } catch {}
  });

  function processAlerts(text: string) {
    for (const alert of parseAlerts(text)) {
      const key = hashText(`${alert.type}\n${alert.body}\n${text.slice(0, 400)}`);
      if (seenAlerts.has(key)) continue;
      seenAlerts.add(key);
      pi.appendEntry<AlertData>(ALERT_ENTRY, alert);
    }
  }

  function processTextBlock(text: string, force: boolean) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const tasks = parseTasks(trimmed);
    if (tasks.length > 0) {
      const sourceHash = hashText(trimmed);
      if (force || !hiddenHashes.has(sourceHash)) {
        hiddenHashes.add(sourceHash);
        pi.appendEntry<MessageData>(MESSAGE_ENTRY, { sourceHash, text: trimmed, tasks });
      }
    }
    processAlerts(trimmed);
  }

  pi.on("message_end", async (event) => {
    try {
      if (event.message?.role !== "assistant") return;
      const content = (event.message as any).content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block?.type === "text" && typeof block.text === "string") processTextBlock(block.text, true);
      }
    } catch {}
  });

  pi.registerCommand("tasks", {
    description: "Tasks in the last assistant message: list | toggle <n> | markdown",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "list").toLowerCase();
      const block = lastAssistantTaskBlock(ctx);
      if (!block) { notify(ctx, "No task checkboxes found in the last assistant message.", "warning"); return; }

      const current = block.tasks.map((task) => ({ ...task, checked: effectiveChecked(block.sourceHash, task) }));

      if (sub === "toggle") {
        const n = Number(parts[1]);
        const task = current.find((t) => t.index === n);
        if (!task) { notify(ctx, `Task ${n} not found. Use /tasks list.`, "warning"); return; }
        toggleTask(pi, block.sourceHash, task, task.checked);
        notify(ctx, `Toggled task ${n}.`, "info");
        return;
      }

      if (sub === "markdown") {
        const markdown = current.map((t) => `- [${t.checked ? "x" : " "}] ${t.text}`).join("\n");
        notify(ctx, markdown, "info");
        return;
      }

      const lines = current.map((t) => `  ${t.index}. [${t.checked ? "x" : " "}] ${t.text}`).join("\n");
      notify(ctx, `Tasks:\n${lines}\n\n/tasks toggle <n> | /tasks markdown`, "info");
    },
  });

  pi.registerCommand("mdextras", {
    description: "Rescan the last assistant response for alerts/tasks",
    handler: async (_args, ctx) => {
      const block = lastAssistantTaskBlock(ctx);
      if (!block) { notify(ctx, "No task checkboxes found in the last assistant message.", "warning"); return; }
      const branch = getBranch(ctx);
      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry?.type !== "message" || entry?.message?.role !== "assistant") continue;
        const content = entry.message.content;
        if (!Array.isArray(content)) break;
        for (const b of content) {
          if (b?.type === "text" && typeof b.text === "string") processTextBlock(b.text, false);
        }
        break;
      }
      notify(ctx, "Scanned the last assistant response.", "info");
    },
  });
}
