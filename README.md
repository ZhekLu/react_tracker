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

### Updating or replanning an existing course

For a revised complete plan that replaces the current structural definition,
use `react-plan-update`, not the lower-level `react-plan-sync` command:

```sh
make react-plan-update PLAN=/absolute/path/to/the_latest_plan.md
```

The safe workflow is:

1. Keep `mode = "full"` and the existing plan `id` in the replacement file.
2. Preserve every `{#stable-id}` whose progress or user content must survive.
   For example, keeping the Day 1 and Day 2 IDs and their task IDs preserves
   their completed states, notes, questions, discussions, and time entries.
3. Give genuinely replacement days/tasks new IDs. Anything omitted from a full
   plan is soft-deleted from the active course but remains recoverable in
   SQLite.
4. Validate without changing the database:

   ```sh
   make react-plan-validate PLAN=/absolute/path/to/the_latest_plan.md
   ```

5. Run the guarded update:

   ```sh
   make react-plan-update PLAN=/absolute/path/to/the_latest_plan.md
   ```

   This validates again, creates a consistent backup under
   `react_tracker/data/backups/`, and runs the full sync in one database
   transaction. A failed sync rolls back; the backup path is printed before
   the sync starts.
6. Inspect the active stable IDs and statuses:

   ```sh
   make react-plan-inspect COURSE=TORL
   ```

Use `react-plan-sync` primarily for the first load of a new course or when a
separate backup is intentionally unnecessary. Use `react-plan-patch` only for a
small partial edit that must not remove omitted structure.

The current TORL plan is updated with:

```sh
make react-plan-update PLAN=study_plans/special_course/trustworthy_offline_rl_thesis_first_sprint_2026_v2_replanned.md
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
  day notes. Questions and PDF captures are grouped compactly by resource and
  chapter directly below their linked task; open an individual capture only
  when its context or actions are needed. Skills belong to the day and are not
  repeated on every task.
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
  resources. Messages are editable, render Markdown/LaTeX, and can answer,
  partially answer, or reference one or many questions. New questions can be
  anchored recursively to any discussion message. Tutor answers can be scanned
  for candidate questions with an editable review step. Pasted tutor responses
  pass through a Markdown syntax tree that repairs the common ChatGPT
  display-math clipboard form, preserves language-labelled code, and compacts
  accidental PDF/chat line breaks. Day prompt discussions link all resources
  used by that day. Explicit `Q-001`, grouped `Q-002 and Q-003`, and `Question
  4` answer headings place the exact prompt-batch questions beside their answers
  with reference, partial, and done controls. Deleting a discussion is a
  recoverable soft deletion rather than destructive database removal.

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
synced from an iPad are included. Keep the local `path`: it supplies searchable
book text, outline structure, and a clean page background, but its annotations
are not imported while a Drawboard URL is configured. Re-running collection is
safe: unchanged marks are reused, changed cloud marks refresh their source
anchors without duplicating them or resetting their tracker status, and marks
removed from the cloud are soft-deleted from the tracker. Manual tracker notes
are never removed by cloud reconciliation.

Text highlights, underlines, and inserted text notes become searchable tracker
captures; red marks and text ending in `?` become questions. Ink, shapes, and
links are reported by type. For book resources with a readable local PDF, the
importer uses the embedded outline to group captures by chapter/subchapter and
matches each quote to its containing sentence plus one sentence on either side.
The compact list shows the containing sentence; opening a capture reveals the
exact marked text and surrounding context.

Red cloud ink is treated as a question. Drawboard's bottom-origin ink
coordinates are converted to the PDF's top-origin page geometry before the
tracker renders a full-width crop, overlays the cloud stroke in its exact RGB
colour, and keeps generous vertical margin around it. Other ink remains counted
but skipped because it has no searchable text. Exact annotation RGB values are
preserved for UI accents; the coarse colour names remain available only for
question/type rules.

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

### Writing formulas and code

Use ordinary Markdown with LaTeX inside dollar delimiters:

```markdown
The target is $V_{k+1}=T_*V_k$.

$$
V_{k+1}(s)=\max_a \sum_{s',r}p(s',r\mid s,a)
\left[r+\gamma V_k(s')\right]
$$
```

Use `$...$` for a formula inside a sentence and `$$...$$` on their own lines
for a displayed derivation. Do not use bare `[ ... ]` when typing manually;
that form is accepted only as a repair for pasted ChatGPT clipboard text.
Click a rendered formula while editing to open its small floating LaTeX editor,
which stays at the bottom-right instead of moving the discussion scroll
position.

For code, use a fenced block and keep the language label so syntax highlighting
can select the right grammar:

````markdown
```python
def bellman_backup(state: int) -> float:
    return reward + gamma * value[next_state]
```
````

The paste importer follows ChatGPT's language-labelled code-block convention
and Tiptap's Markdown/LaTeX model. It runs only for paste and **Paste response**:
manual saves preserve deliberate one-word paragraphs and line breaks. During a
paste, short prose fragments are joined, small standalone formulas become
inline formulas, and a short `text` fence becomes inline code. Python and other
programming-language fences always remain blocks. See the
[OpenAI code-block guide](https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt),
[Tiptap Markdown guide](https://tiptap.dev/docs/editor/markdown/getting-started/basic-usage),
and [Tiptap mathematics extension](https://tiptap.dev/docs/editor/extensions/nodes/mathematics).

### Discussion review and coding-instruction exports

Edit any tutor message and select prose, a formula, or a code block. The compact
selection card creates a follow-up attached to that exact excerpt; `Cmd+Enter`
queues it and **Save** stores the edited message and its follow-ups together.
**Copy follow-ups** includes the selected excerpt and question under stable
`Q-###` headings so a later pasted response maps back to the correct place.
`Cmd+H` and `Cmd+Shift+H` also work on formula/code selections: those structured
highlights are stored as review annotations and appear in **Highlights** with
surrounding context even though no colour overlay is drawn on the formula/code.

To send tutor instructions to the course coding workspace, wrap them in a
snake-case export tag:

```markdown
<day4_code_task>
## Implementation order

1. Add the Bellman backup.
2. Run the seeded experiment.
</day4_code_task>
```

On save, the content is synchronized to `day4_code_task.md`. Re-saving replaces
that message's previous exported block instead of duplicating it; another tag
with the same name appends another tracker-owned block. Any hand-written content
already in the file stays untouched. In reading mode the exported instructions
are collapsed so theory remains easy to scan. Configure each course destination
beside the file roots in `course_files.json`:

```json
{
  "discussion_export_roots": {
    "TORL": "../../special_course/exercises/discussions"
  }
}
```

### Course file mentions

Machine-local code roots are configured in `course_files.json`. Each key is a
course short code and each value is a list of absolute paths or paths relative
to that config file:

```json
{
  "course_file_roots": {
    "TORL": ["../../special_course/exercises"]
  }
}
```

Write `@day2_simulate_bandits.py` or a relative path such as
`@discussions/day2_fixes.md` in a saved note. The rendered note shows a compact
file chip; clicking it opens the current filesystem file in its macOS default
application. The tracker indexes only the configured folders—it does not copy
file contents into SQLite or track file versions.

The ChatGPT attachment directory is cleaned in place on each structured copy.
The directory itself is no longer deleted, so Finder tags (including your red
tag) and folder-level metadata survive while stale attachment files are removed.

### Keyboard-first lecture reader

Local PDF resources whose plan kind is `slides` open in the full-size in-app
lecture reader. Use Left/Right or Page Up/Page Down to move between slides;
Home/End jump to the beginning or end. The current slide is kept in the URL so
browser Back returns to the exact course/day context.

While the slide has keyboard focus, start typing anywhere to open a slide-linked
note. Start with `?` for a question or `!` for a todo; otherwise it starts as a
normal note. `Cmd+Enter` saves and Escape cancels. Notes are stored as ordinary
resource annotations with the slide number and the extracted slide heading, so
they immediately appear in the task shelf, Notes, and discussions.

Quick slide questions always retain the rendered slide in their expandable
tracker context. Add `/screen` anywhere in the draft when that slide must also
be copied into the next ChatGPT attachment bundle; the command is removed from
the saved question. `??` and `todo!` also promote a draft to a coloured question
or todo before it is saved.

### Book chapter progress

Book resources show a dense row of chapter squares both in Resources and beside
chapter-scoped Roadmap tasks. Planned-but-unread chapters are outlined, unplanned
chapters are grey, partial chapters are half green, and completed chapters are
solid green. Click a square to cycle **unread → partial → read → unread**. The
state is stored in SQLite and is independent from the whole-resource status.

The complete chapter list is configured by stable plan resource id in
`course_files.json` under `book_chapters`; planned chapters are derived from
task text such as `Read Sections 3.1-3.6`, so plan updates change the outline
without erasing the progress you recorded.

### Pet completion animations

Transparent animal GIFs live in `../gifs/`. Task and perfect-day effects are
configured in `../pet_animations.json`; the task preset defaults to one small
scampering pet, while a fully completed day uses a short multi-pet firework.
Change the animation, number of copies, duration, or size without touching the
Roadmap component.

Open `/?petLab=1` (or use **Pet animation lab** at the bottom of the sidebar) to
test every GIF with the `scamper`, `parade`, `orbit`, `bounce`, and `firework`
motions. The lab has task/day presets, live size/copy/duration controls, a full
GIF-by-motion matrix, and a copyable JSON preset.

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
