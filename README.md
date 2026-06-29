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

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/frontend
npm install
npm run dev
```

The frontend loads courses from the backend API at `http://127.0.0.1:8787/api`.
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
- `pdf_app` selects the desktop PDF application.
- Non-PDF files use the system default application.

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

The dump importer is optional for new courses. A future course-creation/import
workflow may populate the same normalized tables directly from a plan and
resource registry; the React components do not depend on legacy dump JSON.

## Daily Workflow

- Use Roadmap for task state, linked source opening, task notes, defer flags, and
  day notes. Skills belong to the day and are not repeated on every task.
- Use Resources for grouped library progress, source opening, resource notes,
  reading state, and resource-linked discussions.
- Use Exams for the compact activity map plus per-question solution notes.
- Use Notes to review and edit notes, active questions, structured annotations,
  and deferred work in one place.
- Use Discussions to keep ordered tutor exchanges attached to one resource.
  Messages are append-only in the current slice; editing and rendered math are
  still tracked as follow-up work.

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
