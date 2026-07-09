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
- Local integrations: PDF extraction, safe file opening, and Toggl run inside
  FastAPI. A production build is served by that same process.
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
   Resources, Exams, notes, annotations, and discussions.
6. Add safe local-resource opening through the Python API. Done.
7. Add consolidated Notes and resource-linked Discussions workspaces. Done.
8. Define native `study-plan/v1` Markdown and parse it independently of
   `build_tracker.py`. Done.
9. Add direct course creation, full re-sync, and non-destructive patching so a
   legacy dump is optional. Done.
10. Migrate annotation capture to the Python API. Done for in-app text
    selection, manual resource/exam questions, and idempotent PDF imports.
11. Replace generated Markdown/HTML wrappers with a sandboxed API-backed
    reader, persisted progress, and selection capture. Done.
12. Add structured question editing, prompt-batch discussions, answer coverage,
    and recursive discussion-message questions. Done.
13. Render Markdown/LaTeX throughout the workspace and add editable Tiptap
    inline/block mathematics without loading the heavy renderers eagerly. Done.
14. Make questions a compact day-oriented navigation surface, expose them
    directly on resources, and extract reviewed candidates from tutor answers.
    Done.
15. Surface linked questions and PDF captures inline on Roadmap and consolidate
    PDF/Toggl operations into the main API. Done.

## Ownership Rules

- Day skills describe the day objective. They are not copied onto every task.
- Tasks own workflow state, optionality, rationale, links, and task notes.
- Resources own reading state, file/URL identity, annotations, resource notes,
  and relationships to ordered discussion resources.
- Discussions are first-class generated resources. Prompt batches seed immutable
  user messages, while message-question relationships distinguish references,
  partial answers, and complete answers.
- Follow-up questions are annotations anchored to discussion messages and use
  the same queue and prompt-batch workflow as source-document questions.
- Discussion deletion soft-deletes the generated resource, thread, and messages.
  This removes it from normal projections while retaining rows for recovery and
  audit history.
- Exam questions own solve state and solution notes.
- Notes and Discussions are projections over the same API workspace, not
  separate stores.
- The database is the source of study state. Markdown plans and registries are
  repeatable structural inputs; old tracker dumps are optional migration input.

## Non-Goals For The First Slice

- Recreating every current feature in one slice.
- Removing the stable static tracker entry point before the React app is proven.
- Editing `tracker.html` directly to support the React app.

## Prompt Attachments, PDF Paragraphs, and Book Scope

Three derived workflows intentionally live outside the database schema:

- `tracker_api/services/prompt_attachment_service.py` owns the ephemeral
  ChatGPT upload folder. It resolves the resources implied by a prompt's
  day/task/resource/question scope, clears the previous folder, copies safe
  local source files, copies red-ink screenshots, and names screenshots with
  the same `Q-xxx` labels used by `prompt_batch_items`.
- `tracker_api/services/prompt_batch_service.py` is the application-level
  orchestrator. It prepares attachments first, appends the exact filenames to
  the prompt, then persists that exact copied prompt through the repository.
  Repositories remain responsible for database writes; filesystem side effects
  remain in the service layer.
- `tracker_api/services/pdf_context_service.py` interprets PDF layout. It maps
  every imported capture to a paragraph-level context group, joins likely
  paragraph continuations across a page break, and shortens very long
  paragraphs to sentence windows around all captures in the group.
- `tracker_api/services/pdf_ink_image_service.py` renders lossless, high-density
  handwriting screenshots. The crop is owned by the red question group, while
  every Drawboard ink stroke and text markup intersecting that crop is rendered
  in its original color. Deliberate vertical guide strokes define independent
  handwriting groups and prevent nearby questions from merging transitively.

Paragraph grouping is a presentation projection rather than a destructive
merge. Each annotation keeps its own ID, anchor, workflow state, note, and
import fingerprint. `AnnotationChapterGroups.tsx` groups annotations sharing
`contextGroupId` into one paragraph card while preserving the individual
annotation controls underneath it.

Open-question filtering is a presentation state. It narrows the current task
to open question/todo annotations, opens all remaining chapter groups and
expands their cards; it never changes annotation persistence. Prompt exports
include notes linked directly to each question because those notes commonly
contain attempted solutions or tutor-specific context.

Book chapter scope is also derived rather than persisted. The backend parses
explicit chapter/section references from task titles in
`chapter_scope_service.py`, exposes chapter numbers on each task, and uses them
for task/day open-question counts. The Roadmap passes the same scope to the
annotation view: relevant chapters open initially and contribute to the task
question count, while all other chapters remain visible but collapsed.
