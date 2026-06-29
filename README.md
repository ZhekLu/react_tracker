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
Use `VITE_TRACKER_API_BASE` only if the API host changes.

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
and note upserts.

Import the frozen normalized dump and then enrich names/resources from the stable
generated tracker:

```sh
cd /Users/eugene/Documents/Thesis/Tracker
make react-import-v2
make react-enrich-plan
```

Raw static tracker exports must be converted first with
`dump/convert_tracker_dump_to_v2.py`; the backend importer expects the normalized
v2 bundle shape.

The target relational model, invariants, import identity rules, and phased
migration order are documented in `../features/db_schema.md`.

Useful checks:

```sh
make react-backend-check
make react-lint
make react-build
```

## Migration Rule

Do not edit generated `../tracker.html` to support this app. Shared parsing logic
should first be extracted from `../build_tracker.py` into reusable modules, then
called by the SQLite importer.
