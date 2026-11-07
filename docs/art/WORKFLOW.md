# Art Pipeline — Docs-as-Source-of-Truth Workflow

Chats are disposable coordinators. The Markdown files in `docs/art/` on GitHub are the only permanent memory.

## Rules

1. Every major decision or completed deliverable becomes (or updates) one standalone Markdown file.
2. A new task starts in a fresh chat with only the relevant docs pasted or referenced. Never rely on prior chat history.
3. The first reply to a new task lists which existing docs are needed. Work only from those plus the new request.
4. Large tasks split into sub-tasks; each sub-task outputs one clean document.
5. Responses stay short and specialized. The doc is the deliverable, not the chat.
6. After docs change, the `github-sync` agent commits and pushes them.

## Folder structure

```
docs/art/
├─ WORKFLOW.md                     this file
├─ <unit>/                         one folder per asset (levy, raider, soldier, ...)
│  ├─ README.md                    index, locked decisions, open items, code anchors
│  ├─ <unit>-art-direction.md
│  ├─ <unit>-topology-budgets.md
│  ├─ <unit>-materials-textures.md
│  ├─ <unit>-rig-spec.md
│  ├─ <unit>-weapon.md
│  └─ <unit>-animation-guidelines.md
└─ environment/                    future: walls, ground, props
```

## Doc conventions

- Header line: `**Status:** … · **Depends on:** … · **Used by:** …`
- Self-contained: restate any constraint the reader needs (numbers, names) instead of pointing at chat history.
- Update the unit `README.md` (locked decisions, open items) whenever a doc changes.
- Status values: `Draft` → `Baseline vN` → `Implemented`.

## Starting a new task (template)

```
Task: <what to produce or change>
Docs: docs/art/levy/README.md, docs/art/levy/levy-rig-spec.md
Output: one updated/new doc in docs/art/<unit>/
```
