/**
 * pi-markdown-extras
 *
 * Enhances chat markdown handling:
 * - GitHub-style alerts ([!NOTE], [!WARNING], [!IMPORTANT], [!TIP], [!CAUTION], etc.)
 *   rendered as companion cards.
 * - Heading outlines for #, ##, ###.
 * - Task checkboxes rendered as an interactive companion card (click to toggle boxes).
 *
 * Note: Pi extensions cannot replace the built-in assistant markdown renderer in-place.
 * Tasks become clickable in the rendered "Tasks" companion card; the original assistant
 * message text is not mutated.
 */

import { Box, Container, MouseRegion, Text } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ALERT_ENTRY = "md-alert";
const OUTLINE_ENTRY = "md-outline";
const TASKS_ENTRY = "md-tasks";
const TASKS_STATE_TYPE = "md-tasks-state";

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
type OutlineData = { headings: Array<{ level: number; text: string }> };
type Task = { index: number; checked: boolean; text: string };
type TasksData = { tasks: Task[]; sourceHash: string };

const taskState = new Map<string, Record<number, boolean>>();

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
      tasks.push({ index: idx, checked: m[2].toLowerCase() === "x", text: m[3].trim() });
    }
  }
  return tasks;
}

function effectiveChecked(sourceHash: string, task: Task): boolean {
  const o = taskState.get(sourceHash);
  if (o && Object.prototype.hasOwnProperty.call(o, task.index)) return !!o[task.index];
  return task.checked;
}

function toggleTask(pi: ExtensionAPI, ctx: ExtensionContext, sourceHash: string, task: Task) {
  const current = effectiveChecked(sourceHash, task);
  const next = { ...(taskState.get(sourceHash) || {}), [task.index]: !current };
  taskState.set(sourceHash, next);
  try { pi.appendEntry(TASKS_STATE_TYPE, { sourceHash, overrides: next, at: new Date().toISOString() }); } catch {}
  try { ctx.ui.requestRender?.(); } catch {}
}

function renderAlert(entry: any, theme: any): Component {
  const d = (entry?.data || {}) as Partial<AlertData>;
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", `${d.icon || "!"} ${d.label || d.type || "Alert"}`), 0, 0));
  for (const line of String(d.body || "").split("\n").slice(0, 40)) box.addChild(new Text(`  ${line}`, 0, 0));
  return box;
}

function renderOutline(entry: any, theme: any): Component {
  const d = (entry?.data || {}) as Partial<OutlineData>;
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", "§ Heading outline"), 0, 0));
  for (const h of d.headings || []) {
    const indent = "  ".repeat(Math.max(0, h.level - 1));
    box.addChild(new Text(`  ${indent}${"#".repeat(h.level)} ${h.text}`, 0, 0));
  }
  return box;
}

function renderTasks(pi: ExtensionAPI, ctx: ExtensionContext, entry: any, theme: any): Component {
  const d = (entry?.data || {}) as Partial<TasksData>;
  const tasks = (d.tasks || []) as Task[];
  const sourceHash = String(d.sourceHash || "");
  const box = new Box(1, 1, (t: string) => theme.bg("customMessageBg", t));
  box.addChild(new Text(theme.fg("accent", "☑ Tasks (click a box to toggle)"), 0, 0));
  for (const task of tasks.slice(0, 60)) {
    const checked = effectiveChecked(sourceHash, task);
    const mark = checked ? "☑" : "☐";
    const row = new Text(`  ${mark} ${task.text}`, 0, 0);
    // Wrap row in a mouse region so clicks toggle this task in supported UIs.
    box.addChild(new MouseRegion(row, (event: any) => {
      if (event?.type === "click" && (!event.button || event.button === "left")) {
        toggleTask(pi, ctx, sourceHash, task);
        return { handled: true, render: true };
      }
      return undefined;
    }));
  }
  box.addChild(new Text(theme.fg("dim", "  (Toggles this card; original assistant message is not mutated. /tasks markdown exports.)"), 0, 0));
  return box;
}

export default function markdownExtras(pi: ExtensionAPI) {
  const seen = new Set<string>();

  pi.registerEntryRenderer<AlertData>(ALERT_ENTRY, (entry, _ctx, theme) => renderAlert(entry, theme));
  pi.registerEntryRenderer<OutlineData>(OUTLINE_ENTRY, (entry, _ctx, theme) => renderOutline(entry, theme));
  pi.registerEntryRenderer<TasksData>(TASKS_ENTRY, (entry, ctx, theme) => renderTasks(pi, ctx as ExtensionContext, entry, theme));

  pi.on("session_start", (_event, ctx) => {
    seen.clear();
    taskState.clear();
    try {
      for (const e of getBranch(ctx)) {
        if (e?.type === "custom" && e?.customType === TASKS_STATE_TYPE) {
          const d = e.data as any;
          if (d?.sourceHash) taskState.set(String(d.sourceHash), d.overrides || {});
        }
      }
    } catch {}
  });

  function processAssistantText(text: string) {
    const key = hashText(text);
    if (!text || seen.has(key)) return;
    seen.add(key);
    for (const alert of parseAlerts(text)) pi.appendEntry<AlertData>(ALERT_ENTRY, alert);
    const headings = parseHeadings(text);
    if (headings.length >= 2) pi.appendEntry<OutlineData>(OUTLINE_ENTRY, { headings });
    const tasks = parseTasks(text);
    if (tasks.length > 0) pi.appendEntry<TasksData>(TASKS_ENTRY, { tasks, sourceHash: key });
  }

  pi.on("message_end", async (event) => {
    try {
      if (event.message?.role !== "assistant") return;
      processAssistantText(messageText(event.message));
    } catch {}
  });

  pi.registerCommand("tasks", {
    description: "Tasks from last assistant message: list | toggle <n> | markdown",
    handler: async (args, ctx) => {
      const parts = (args || "").trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "list").toLowerCase();
      const text = lastAssistantText(ctx);
      const tasks = parseTasks(text);
      if (tasks.length === 0) { notify(ctx, "No task checkboxes found in last assistant response.", "warning"); return; }
      const sourceHash = hashText(text);
      if (sub === "toggle") {
        const n = Number(parts[1]);
        const task = tasks.find((t) => t.index === n);
        if (!task) { notify(ctx, `Task ${n} not found. Use /tasks list.`, "warning"); return; }
        toggleTask(pi, ctx, sourceHash, task);
        pi.appendEntry<TasksData>(TASKS_ENTRY, { tasks, sourceHash });
        notify(ctx, `Toggled task ${n}.`, "info");
        return;
      }
      if (sub === "markdown") {
        const md = tasks.map((t) => `- [${effectiveChecked(sourceHash, t) ? "x" : " "}] ${t.text}`).join("\n");
        notify(ctx, md, "info");
        return;
      }
      pi.appendEntry<TasksData>(TASKS_ENTRY, { tasks, sourceHash });
      notify(ctx, "Tasks card shown. Click boxes in supported UIs, or use /tasks toggle <n>.", "info");
    },
  });

  pi.registerCommand("mdextras", {
    description: "Rescan last assistant response for alerts/headings/tasks",
    handler: async (_args, ctx) => {
      const text = lastAssistantText(ctx);
      if (!text) { notify(ctx, "No assistant response found.", "warning"); return; }
      seen.delete(hashText(text));
      processAssistantText(text);
      notify(ctx, "Scanned last assistant response.", "info");
    },
  });
}
