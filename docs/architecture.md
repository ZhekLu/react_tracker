# Architecture Notes

## Current Decision

Build the React app as a parallel replacement, not an in-place rewrite.

Reasons:

- The generated `tracker.html` is currently useful and should stay recoverable.
- A React app can evolve toward real routing, editor state, async data loading,
  SQLite persistence, and richer annotation surfaces.
- Keeping the folders separate avoids accidental breakage while Big Data study
  work continues.

## Runtime

- Frontend: Vite, React, TypeScript.
- Rich editor: Tiptap/ProseMirror.
- Backend: FastAPI, SQLAlchemy, Pydantic, SQLite.
- Backend environment: dedicated `uv` project under `backend/`.
- Plan input: Markdown files under `../study_plans/`.
- Generated/imported state: SQLite, not hardcoded HTML.

## Migration Slices

1. UI shell with mock course/day/resource data. Done.
2. Add SQLite tables for courses, days, tasks, resources, notes, discussions,
   exams, and time entries. Done via SQL migrations.
3. Import the frozen normalized dump into SQLite. Done.
4. Enrich imported rows from current plans while preserving known IDs and
   creating unseen tasks/resources. Done through `make react-sync-plans`.
5. Replace mock/local-only progress with API persistence. Done for Roadmap,
   Resources, Exams, and day notes.
6. Move plan parsing from `build_tracker.py` into shared import modules.
7. Migrate annotation wrappers to post into the Python API.

## Non-Goals For The First Slice

- Recreating every current feature in one slice.
- Removing the stable static tracker entry point before the React app is proven.
- Editing `tracker.html` directly to support the React app.
