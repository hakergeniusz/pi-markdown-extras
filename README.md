# pi-markdown-extras

Pi extension that enhances markdown handling in chat by detecting common structures in assistant responses and rendering helpful companion cards.

## Features

- **GitHub-style alerts/admonitions**: detects blockquotes like `> [!NOTE]`, `> [!WARNING]`, `> [!IMPORTANT]`, `> [!TIP]`, `> [!CAUTION]` (and `INFO`, `SUCCESS`, `DANGER`, `ERROR`, `BUG`, `EXAMPLE`, `QUOTE`) and renders labeled alert cards.
- **Headings outline**: when an assistant response contains multiple `#`, `##`, or `###` headings, renders a compact outline card.
- **Task checkboxes**: detects `- [ ]` / `- [x]` items and renders a task card.

## Commands

```text
/mdextras           # rescan last assistant response for alerts/headings/tasks
/tasks              # show tasks from last assistant response
/tasks toggle <n>   # toggle task n in a session-scoped task view (renders updated card)
/tasks markdown     # print toggled task markdown
```

## Limits

- Pi extensions (as used here) cannot replace the **built-in assistant markdown renderer in place**. This extension adds **rendered companion cards** and helper commands; it does not modify the original assistant message rendering/history.
- Task toggles update a **session-scoped view** and can produce updated markdown via `/tasks markdown`; the original assistant message is not mutated.
- Headings `#`/`##`/`###` are also rendered by Pi’s normal markdown support; this extension adds an outline/extra visibility when multiple headings are present.

## Install

```bash
pi install git:github.com/hakergeniusz/pi-markdown-extras
```

## License

MIT
