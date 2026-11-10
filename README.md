# pi-markdown-extras

Pi extension that improves chat markdown handling.

## Features

- **GitHub-style alerts/admonitions**: `> [!NOTE]`, `[!WARNING]`, `[!IMPORTANT]`, `[!TIP]`, `[!CAUTION]` (also `INFO`, `SUCCESS`, `DANGER`, `ERROR`, `BUG`, `EXAMPLE`, `QUOTE`) rendered as labeled alert cards.
- **Inline task checkboxes**: `- [ ]` / `- [x]` stay exactly where the model wrote them, in Pi's normal markdown look. Each task line is clickable: click it to toggle `[ ]` / `[x]`.
- **Normal headings**: `#`, `##`, and `###` render through Pi's normal Markdown renderer, in place. There is no separate heading-outline card.

## How inline task toggling works

Pi's built-in assistant Markdown renderer does not expose per-line mouse regions to extensions. When an assistant text block contains task items, this extension:

1. hides that block's default rendering with a display-only Markdown transformer,
2. stores the block in a durable custom entry, and
3. re-renders the block with Pi's normal `Markdown` component, wrapping only the task lines in mouse regions.

The session and the model context are not modified. The custom entry is TUI-only and does not participate in LLM context.

Clicking requires Pi's fullscreen TUI (`tuiMode: "fullscreen"`, the default). In tmux, enable mouse support (`set -g mouse on`). If clicking is not available, use the commands below.

## Commands

```text
/tasks              # list tasks from the last assistant message
/tasks toggle <n>   # toggle task n
/tasks markdown     # print the current task list as markdown
/mdextras           # rescan the last assistant response for alerts/tasks
```

## Install

```bash
pi install git:github.com/hakergeniusz/pi-markdown-extras
```

## Limits

- Task toggles are display state, not edits to the original assistant message or model context.
- Alerts are companion cards; the original blockquote remains in the message.
- Task-line interaction is implemented by re-rendering the containing text block as a custom entry. Other Markdown transformers from other extensions do not run on that entry.

## License

MIT
