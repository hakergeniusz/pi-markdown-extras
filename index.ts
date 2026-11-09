/**
 * pi-markdown-extras
 *
 * Enhances chat markdown handling:
 * - Auto-detects GitHub-style alerts ([!NOTE], [!WARNING], [!IMPORTANT], [!TIP], [!CAUTION], etc.)
 *   in assistant messages and renders clear alert cards.
 * - Extracts/renders heading outlines for #, ##, ###.
 * - Finds task checkboxes ([ ] / [x]) and provides toggle helpers.
 *
 * Note: Pi extensions cannot replace the built-in assistant markdown renderer in-place.
 * This extension adds rendered companion cards and commands. Task toggles are tracked as a
 * toggled view/snippet (session-scoped) rather than mutating historical assistant messages.
 */

import { Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ALERT_ENTRY = "md-alert";
const OUTLINE_ENTRY = "md-outline";
const TASKS_ENTRY = "md-tasks";

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

type AlertData = { type: string; label: string; icon: string; body: string; source?: string };
type OutlineData = { headings: Array<{ level: number; text: string }> };
type Task = { index: number; checked: boolean; text: string; raw: string };
type TasksData = { tasks: Task[]; overrides?: Record<number, boolean>; sourceHash?: string };

function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
  try { ctx.ui.notify(message, level); } catch {}
}

function getBranch(ctx: ExtensionContext): any[] {
  try { return (ctx.sessionManager.getBranch() as any[]) || []; } catch { return []; }
}

function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.filter((c: any) => c?.type === "text").map((c: any) => c.text || "").join("\n\n");
  return "";
}

function lastAssistantText(ctx: ExtensionContext): string {
  const branch = getBranch(ctx);
  for (let i = branch.length - 1; i >= 0; i--) {
    const e = branch[i];
    if (e?.type === "message" && e?.message?.role === "assistant") return messageText(e.message);
  }
  return "";
}

function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h);
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

function parseHeadings(text: string): OutlineData["headings"] {
  const headings: OutlineData["headings"] = [];
  let inFence = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }
  return headings;
}

function parseTasks(text: string): Task[] {
  const tasks: Task[] = [];
  let inFence = false;
  let idx = 0;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(\s*[-*+]\s*)\[([ xX])\]\s+(.*)$/);
    if (m) {
      idx++;
      tasks.push({ index: idx, checked: m[2].toLowerCase() === "x", text: m[3].trim(), raw: line });
    }
  }
  return tasks;
}

function applyTaskOverrides(tasks: Task[], overrides: Record<number, boolean> = {}): Task[] {
  return tasks.map((t) => ({ ...t, checked: overrides[t.index] ?? t.checked }));
}

function renderAlert(entry: any, theme: any) {
  const d = (entry?.data || {}) as Partial<AlertData>;
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", `${d.icon || "!"} ${d.label || d.type || "Alert"}`), 0, 0));
  for (const line of String(d.body || "").split("\n").slice(0, 30)) box.addChild(new Text(`  ${line}`, 0, 0));
  return box;
}

function renderOutline(entry: any, theme: any) {
  const d = (entry?.data || {}) as Partial<OutlineData>;
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", "§ Heading outline"), 0, 0));
  for (const h of d.headings || []) {
    const indent = "  ".repeat(Math.max(0, h.level - 1));
    box.addChild(new Text(`  ${indent}${"#".repeat(h.level)} ${h.text}`, 0, 0));
  }
  return box;
}

function renderTasks(entry: any, theme: any) {
  const d = (entry?.data || {}) as Partial<TasksData>;
  const tasks = applyTaskOverrides(d.tasks || [], d.overrides || {});
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", "☑ Tasks (use /tasks toggle <n>)"), 0, 0));
  for (const t of tasks.slice(0, 40)) {
    box.addChild(new Text(`  ${t.index}. [${t.checked ? "x" : " "}] ${t.text}`, 0, 0));
  }
  return box;
}

export default function markdownExtras(pi: ExtensionAPI) {
  const seen = new Set<string>();
  let lastTasks: TasksData | null = null;

  pi.registerEntryRenderer<AlertData>(ALERT_ENTRY, (entry, _ctx, theme) => renderAlert(entry, theme));
  pi.registerEntryRenderer<OutlineData>(OUTLINE_ENTRY, (entry, _ctx, theme) => renderOutline(entry, theme));
  pi.registerEntryRenderer<TasksData>(TASKS_ENTRY, (entry, _ctx, theme) => renderTasks(entry, theme));

  pi.on("session_start", () => {
    seen.clear();
    lastTasks = null;
  });

  function processAssistantText(text: string) {
    const key = hashText(text);
    if (!text || seen.has(key)) return;
    seen.add(key);
    const alerts = parseAlerts(text);
    for (const alert of alerts) pi.appendEntry<AlertData>(ALERT_ENTRY, alert);
    const headings = parseHeadings(text);
    if (headings.length >= 2) pi.appendEntry<OutlineData>(OUTLINE_ENTRY, { headings });
    const tasks = parseTasks(text);
    if (tasks.length > 0) {
      lastTasks = { tasks, overrides: {}, sourceHash: key };
      pi.appendEntry<TasksData>(TASKS_ENTRY, lastTasks);
    }
  }

  pi.on("message_end", async (event) => {
    try {
      if (event.message?.role !== "assistant") return;
      processAssistantText(messageText(event.message));
    } catch {}
  });

  pi.registerCommand("tasks", {
    description: "Task checkboxes from last assistant message: list | toggle <n> | markdown",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "list").toLowerCase();
      if (!lastTasks || lastTasks.tasks.length === 0) {
        const text = lastAssistantText(ctx);
        const tasks = parseTasks(text);
        if (tasks.length === 0) { notify(ctx, "No task checkboxes found in last assistant message.", "warning"); return; }
        lastTasks = { tasks, overrides: {}, sourceHash: hashText(text) };
      }
      if (sub === "toggle") {
        const n = Number(parts[1]);
        if (!Number.isFinite(n) || n < 1) { notify(ctx, "Usage: /tasks toggle <n>", "warning"); return; }
        const tasks = applyTaskOverrides(lastTasks.tasks, lastTasks.overrides);
        const t = tasks.find((x) => x.index === n);
        if (!t) { notify(ctx, `Task ${n} not found.`, "warning"); return; }
        lastTasks.overrides = { ...(lastTasks.overrides || {}), [n]: !t.checked };
        pi.appendEntry<TasksData>(TASKS_ENTRY, lastTasks);
        notify(ctx, `Toggled task ${n}. (View updated; original message not mutated.)`, "info");
        return;
      }
      if (sub === "markdown") {
        const tasks = applyTaskOverrides(lastTasks.tasks, lastTasks.overrides);
        const md = tasks.map((t) => `- [${t.checked ? "x" : " "}] ${t.text}`).join("\n");
        notify(ctx, md, "info");
        return;
      }
      pi.appendEntry<TasksData>(TASKS_ENTRY, lastTasks);
      notify(ctx, "Tasks shown. Use /tasks toggle <n> or /tasks markdown.", "info");
    },
  });

  pi.registerCommand("mdextras", {
    description: "Markdown extras: scan last response for alerts/headings/tasks",
    handler: async (_args, ctx) => {
      const text = lastAssistantText(ctx);
      if (!text) { notify(ctx, "No assistant response found.", "warning"); return; }
      seen.delete(hashText(text)); // allow rescan
      processAssistantText(text);
      notify(ctx, "Scanned last assistant response for alerts/headings/tasks.", "info");
    },
  });
}
