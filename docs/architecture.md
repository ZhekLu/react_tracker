# Architecture Notes

## Current Decision

Build the React app as a parallel replacement, not an in-place rewrite.

Reasons:

- The generated `tracker.html` is currently useful and should stay recoverable.
- A React app can evolve toward real routing, editor state, async data loading,
  SQLite persistence, and richer annotation surfaces.
- Keeping the folders separate avoids accidental breakage while Big Data study
  work continues.

## Proposed Runtime

- Frontend: Vite, React, TypeScript.
- Rich editor: Tiptap/ProseMirror.
- Backend: Python API with SQLite.
- Plan input: Markdown files under `../study_plans/`.
- Generated/imported state: SQLite, not hardcoded HTML.

## Migration Slices

1. UI shell with mock course/day/resource data.
2. Read parsed JSON from the existing generator or `resource_registry.json`.
3. Add SQLite tables for courses, days, tasks, resources, notes, discussions,
   exams, and time entries.
4. Move plan parsing from `build_tracker.py` into shared import modules.
5. Replace localStorage progress with API persistence.
6. Migrate annotation wrappers to post into the Python API.

## Non-Goals For The First Slice

- Recreating every current feature.
- Moving real notes out of browser localStorage.
- Replacing the existing static tracker entry point.
