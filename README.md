# React Study Tracker

This is the next-generation tracker app. It is intentionally separate from the
stable generated `../tracker.html` workflow.

Goals:

- Keep `tracker.html` working while the React app is built feature by feature.
- Move UI state and study progress toward a Python + SQLite backend.
- Keep plan inputs readable Markdown files under `../study_plans/`.
- Use a real editor component from the beginning, not a custom textarea renderer.

## Structure

```text
react_tracker/
  frontend/          Vite + React + TypeScript app
  backend/           FastAPI + SQLite backend managed by uv
  data/              Local SQLite databases, ignored by git
  docs/              migration notes and architecture decisions
```

## Frontend

For normal use, build and run the complete app as one local server:

```sh
cd /Users/eugene/Documents/Thesis/Tracker
make react-app
```

Open `http://127.0.0.1:8787`. FastAPI serves both the API and the built React
frontend. PDF collection and Toggl controls are part of this same process;
`make toggl-server` is only retained for the legacy `tracker.html`.

For frontend development with hot-module reload, use two terminals:

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/frontend
npm install
npm run dev
```

Run `make react-api` in the other terminal. The development frontend loads
courses from the backend API at `http://127.0.0.1:8787/api`.
Use `VITE_TRACKER_API_BASE` only if the API host changes. The active course is
selected in the compact sidebar dropdown; Roadmap, Resources, Exams, Notes, and
Discussions all use the same API-owned workspace.

Editor choice: Tiptap, which is built on ProseMirror. It gives us a stable editor
foundation for highlights, rich notes, task lists, tables, code blocks, formulas,
and future image/PDF annotation workflows.

Frontend conventions are documented in
`docs/frontend-conventions.md`. New screens should reuse the design tokens,
status colors, progress components, and completion-reward hook established by
the current Roadmap, Resources, and Exams views.

The complete legacy-parity and improvement inventory is maintained in
`../features/react_migration_checklist.md`. Update its statuses whenever a
feature slice is implemented or deliberately deferred.

## Backend

The backend uses a dedicated `uv` environment and stores local state in SQLite:

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/backend
uv sync
uv run python -m tracker_api.main
```

It creates `../data/tracker_v2.db`, applies SQL migrations on startup, and serves
typed FastAPI endpoints for courses, complete course workspaces, status updates,
rich-note upserts, annotation actions, resource opening, and resource-linked
discussion threads.

Local resource opening is controlled by `../toggl_config.json`:

- `open_allowed_roots` limits which local paths the API may open.
- `pdf_app` selects the desktop PDF application. When it is configured, opening
  a PDF fails visibly if that application is unavailable instead of silently
  falling back to Preview.
- Non-PDF files use the system default application.
- PDF annotation collection is extracted and persisted atomically by the API.
  Its report distinguishes newly saved captures from annotations that were
  already in SQLite.
- Toggl status/start/stop, caching, and rate-limit backoff are owned by this API.

Keep those values local and machine-specific. A missing source path is reported
to the frontend instead of being silently ignored.

Import the frozen normalized dump once, then load the current Markdown plans:

```sh
cd /Users/eugene/Documents/Thesis/Tracker
make react-import-v2
make react-sync-plans
```

Raw static tracker exports must be converted first with
`dump/convert_tracker_dump_to_v2.py`; the backend importer expects the normalized
v2 bundle shape.

For normal plan edits, run only `make react-sync-plans`. It rebuilds the stable
generated source and upserts every current task/resource into SQLite with
deterministic IDs. Existing completion state is preserved, new rows start open,
and unmatched dump-only tasks are soft-deleted from the active workspace while
remaining recoverable in SQLite.

The dump importer is optional for new courses. Native `study-plan/v1` files
populate the normalized tables directly; the React components do not depend on
legacy dump JSON.

## Native Plan Authoring

New courses should use `study-plan/v1`, a Markdown file with small TOML
frontmatter and explicit stable IDs for days and tasks. It can create a course
without a legacy dump and can be safely re-synced after an AI or human edits the
plan:

```sh
make react-plan-validate PLAN=features/study_plan_v1_template.md
make react-plan-sync PLAN=/absolute/path/to/my_course_plan.md
```

For a revised complete plan that replaces the current structural definition,
use the guarded update command:

```sh
make react-plan-update PLAN=/absolute/path/to/the_latest_plan.md
```

It validates first, creates a consistent SQLite backup under
`react_tracker/data/backups/`, and only then runs the full sync. Stable day,
task, resource, and skill IDs update in place, preserving progress and
user-created content. Review the file diff before running it because structure
omitted from a full plan is soft-deleted.

The current TORL plan is updated with:

```sh
make react-plan-update PLAN=study_plans/special_course/trustworthy_offline_rl_thesis_first_sprint_2026_latest.md
```

For a deliberately partial change, use `mode = "patch"` and:

```sh
make react-plan-patch PATCH=/absolute/path/to/my_course_patch.md
```

Matching IDs preserve task progress, notes, annotations, discussions, and time
entries. Full syncs soft-delete removed structure; patches never remove omitted
rows. The complete format, patch semantics, and AI-generation rules are in
`../features/study_plan_format.md`.

## Daily Workflow

- Use Roadmap for task state, linked source opening, task notes, defer flags, and
  day notes. Questions and PDF captures are expanded directly below their linked
  task, with source, page, conversion, follow-up, answer, and archive actions.
  Skills belong to the day and are not repeated on every task.
- Use Resources for grouped library progress, source opening, resource notes,
  reading state, PDF comment/highlight collection, and resource-linked
  discussions. Every source has a visible Ask action and an inline question
  shelf. Markdown, HTML, text, code, JSON, and CSV files open in the in-app
  reader; select text there to save a highlight or structured question.
- Use Exams for the compact activity map plus per-question solution notes.
- Use Notes to review and edit notes, active questions, structured annotations,
  deferred work, and the meeting scratchpad in one place. The default question
  queue is compact, grouped and filterable by linked study day, and each day
  link returns to its roadmap card. Question text and priority are editable.
  Structured copy actions save an immutable prompt-batch snapshot alongside the
  clipboard text and can start a linked discussion.
- Use Discussions to keep ordered tutor exchanges attached to one or more source
  resources. Messages are immutable, render Markdown/LaTeX, and can answer,
  partially answer, or reference one or many questions. New questions can be
  anchored recursively to any discussion message. Tutor answers can be scanned
  for candidate questions with an editable review step. Deleting a discussion
  is a recoverable soft deletion rather than destructive database removal.

### Drawboard cloud PDFs

A resource may keep its local archival path and use a Drawboard sharing URL as
its live annotation source:

```toml
[resources.rl-book]
title = "Reinforcement Learning: An Introduction, second edition"
path = "/absolute/path/to/RLbook2020.pdf"
url = "https://pdf.drawboard.com/documents/links/.../consume"
kind = "book"
```

After editing a full plan, load it with `make react-plan-update PLAN=...`. For a
resource with this URL, the normal **Open** action resolves the shared document
and opens its cloud document ID in the Drawboard PDF macOS app. **Collect PDF
notes** reads the current cloud annotations instead of the local file, so marks
synced from an iPad are included. Re-running collection is safe: unchanged marks
are reused and changed cloud marks refresh their source anchors without
duplicating them or resetting their tracker status.

Text highlights, underlines, and inserted text notes become searchable tracker
captures; red marks and text ending in `?` become questions. Ink, shapes, and
links are reported by type. For book resources with a readable local PDF, the
importer uses the embedded outline to group captures by chapter/subchapter and
matches each quote to its containing sentence plus one sentence on either side.
The compact list shows the containing sentence; opening a capture reveals the
exact marked text and surrounding context.

Red cloud ink is treated as a question. The tracker renders a full-width local
page crop, overlays the cloud stroke in its exact RGB colour, and keeps generous
vertical margin around it. Other ink remains counted but skipped because it has
no searchable text. Exact annotation RGB values are preserved for UI accents;
the coarse colour names remain available only for question/type rules.

The anonymous sharing credentials are cached with owner-only permissions in the
gitignored `drawboard_state.json`. Generated handwriting crops live in the
gitignored `react_tracker/data/annotation_images/` directory and are served only
by the local tracker API.

The cloud reader is a compatibility integration with Drawboard's current web
client rather than a documented public API. If Drawboard changes that protocol,
collection fails visibly and leaves existing tracker annotations untouched.

Tiptap notes support editable inline and block formulas. Read-only Markdown
surfaces use the same lazy KaTeX renderer so formula syntax remains consistent
across notes, questions, plans, resource descriptions, and discussions.

The target relational model, invariants, import identity rules, and phased
migration order are documented in `../features/db_schema.md`.

Useful checks:

```sh
make react-backend-check
make react-lint
make react-build
make react-check
```

## Migration Rule

Do not edit generated `../tracker.html` by hand. Edit the Markdown plan,
registry, or parser source, then run `make react-sync-plans`.
