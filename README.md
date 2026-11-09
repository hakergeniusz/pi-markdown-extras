# pi-markdown-extras

Pi extension that enhances markdown handling in chat by detecting common structures in assistant responses and rendering helpful companion cards.

## Features

- **GitHub-style alerts/admonitions**: `> [!NOTE]`, `[!WARNING]`, `[!IMPORTANT]`, `[!TIP]`, `[!CAUTION]` (also `INFO`, `SUCCESS`, `DANGER`, `ERROR`, `BUG`, `EXAMPLE`, `QUOTE`) rendered as labeled alert cards.
- **Headings outline**: when a response contains multiple `#`, `##`, or `###` headings, renders a compact outline card.
- **Task checkboxes**: detects `- [ ]` / `- [x]` items and renders a **Tasks** card with visual boxes (`☐` unchecked, `☑` checked). Rows are wrapped in mouse regions so they can be **clicked to toggle** in UIs that route mouse events to entry-rendered components.

## Commands

```text
/mdextras           # rescan last assistant response for alerts/headings/tasks
/tasks              # show tasks from last assistant response
/tasks toggle <n>   # toggle task n (fallback / explicit)
/tasks markdown     # print toggled task markdown
```

## Limits

- Pi extensions (as used here) cannot replace the **built-in assistant markdown renderer in place**. The original assistant message still uses Pi’s normal rendering; this extension adds **rendered companion cards**.
- “Clickable/toggleable in the UI” is implemented for the **Tasks companion card** (`MouseRegion` + `☐`/`☑`). If your Pi UI context does not deliver mouse events to that card, use `/tasks toggle <n>`.
- Toggles are **session-scoped** and do **not mutate** the original assistant message/history. Use `/tasks markdown` to export the toggled state.

## Install

```bash
pi install git:github.com/hakergeniusz/pi-markdown-extras
```

## License

MIT
