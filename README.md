# React Study Tracker

Plan maintenance: [complete patching reference](docs/plan-patching.md), including
task administration, stable IDs, deletion, resources and safe recovery.

For the keyboard-first study loop and current interaction conventions, see
[UI_WORKFLOWS.md](UI_WORKFLOWS.md).
For the immutable question-ID and discussion-mapping contract, see
[docs/discussion-data-integrity.md](docs/discussion-data-integrity.md).

This repository is the full tracker application. Its source history and runtime
are independent from the legacy generated `tracker.html` project in the parent
directory.

Goals:

- Keep study state in a stable, backed-up SQLite database.
- Keep plan inputs as readable `study-plan/v1` Markdown files.
- Serve the built React UI and FastAPI from one low-overhead local process.
- Make installation, checks, rebuilds, and the always-on service reproducible.

## Structure

```text
react_tracker/
  Makefile           User-facing build, plan, and service commands
  frontend/          Vite + React + TypeScript app
  backend/           FastAPI + SQLite backend managed by uv
  data/              Machine-local database, credentials, logs, and screenshots
  docs/              migration notes and architecture decisions
  scripts/           Persistent local service management
```

## Install and run

Requirements are macOS, Python 3.12, `uv`, Node.js, and npm. Both dependency
trees are locked (`backend/uv.lock` and `frontend/package-lock.json`).

First setup:

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker
make install
make build
make service-install
```

Open `http://127.0.0.1:8787`. FastAPI serves both the API and the built React
frontend. PDF collection and Toggl controls live in that same process, so this
app does not need a separate Toggl helper server.

The always-on process uses one named `tmux` session. It has much less idle
overhead and rebuild cost than Docker for this single-user local app, retains
macOS permission to read course files under `Documents`, and gives us clean
start/stop/restart/status semantics without PID files or broad `kill` commands.
The session survives terminal windows closing and restarts the app process after
a crash. After a Mac reboot, run `make service-start` once.

Normal maintenance:

```sh
make service-status       # named session state plus /api/health
make service-restart      # restart without rebuilding
make rebuild              # rebuild the UI and restart
make update               # sync locked deps, rebuild, restart
make logs                 # follow stdout/stderr
make service-attach       # inspect the live tmux pane
make service-stop
make service-start
```

The persistent log is `data/logs/tracker.log`. It includes request IDs for every
API read and write, write outcomes at `INFO`, client failures at `WARNING`, and
stack traces at `ERROR`. Debug request logging is enabled while the tracker is
being stabilized. Set `TRACKER_LOG_LEVEL=INFO` in `backend/.env` and restart the
service to disable it later. Logs rotate automatically at 5 MiB with four old
files retained; `TRACKER_LOG_MAX_BYTES` and `TRACKER_LOG_BACKUP_COUNT` can
override those service defaults.

To run the built app in the foreground instead:

```sh
make app
```

## Development

For frontend development with hot-module reload, use two terminals:

```sh
make dev-api
make dev-ui
```

The development frontend loads courses from the backend API at
`http://127.0.0.1:8787/api`.
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

## Backend

The backend uses a dedicated `uv` environment, applies SQL migrations on startup,
and stores machine-local state under `data/`. Important files are:

- `data/tracker_v2.db` — primary SQLite database.
- `data/toggl_config.json` — allowed filesystem roots and preferred PDF app.
- `data/toggl_state.json` — cached Toggl state and credentials.
- `data/drawboard_state.json` — cached Drawboard credentials.
- `course_files.json` — tracked course file roots and discussion export config.

Copy `backend/.env.example` to `backend/.env` only when a default path or port
must be overridden.

- `open_allowed_roots` limits which local paths the API may open.
- `resource_file_roots` in `course_files.json` adds explicitly trusted resource
  folders for opening, reading and collecting PDF annotations. Relative paths
  resolve beside that config; `~` expands to your home directory. Write spaces
  normally (no shell quotes or backslashes inside the JSON path). The configured
  iCloud papers folder is read directly; PDFs are never copied into Drawboard Cloud.
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

## Native Plan Authoring

New courses should use `study-plan/v1`, a Markdown file with small TOML
frontmatter and explicit stable IDs for days and tasks. It can create a course
without a legacy dump and can be safely re-synced after an AI or human edits the
plan:

```sh
make plan-validate PLAN=/absolute/path/to/my_course_plan.md
make plan-sync PLAN=/absolute/path/to/my_course_plan.md
```

### Updating or replanning an existing course

For a revised complete plan that replaces the current structural definition,
use `plan-update`, not the lower-level `plan-sync` command:

```sh
make plan-update PLAN=/absolute/path/to/the_latest_plan.md
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
   make plan-validate PLAN=/absolute/path/to/the_latest_plan.md
   ```

5. Run the guarded update:

   ```sh
   make plan-update PLAN=/absolute/path/to/the_latest_plan.md
   ```

   This validates again, creates a consistent backup under
   `data/backups/`, and runs the full sync in one database
   transaction. A failed sync rolls back; a successful result includes the
   backup path. Backups are retained if a later import check fails.
6. Inspect the active stable IDs and statuses:

   ```sh
   make plan-inspect COURSE=TORL
   ```

All real CLI syncs and patches now create a backup automatically. Use
`make plan-preview PLAN=...` for a rollback-only check against the live database.
Use `plan-sync` primarily for the first load of a new course. Use `plan-patch` for a
partial edit that must not remove omitted structure. See
[daily patches and task tutor reviews](docs/plan-patches-and-task-reviews.md)
for Markdown task-note blocks, conflict handling, and the Copy → Insert review →
Q&A workflow. All feature changes and known gaps are recorded in the
[feature log](docs/feature-log.md).

The current TORL plan is updated with:

```sh
make plan-update PLAN=../study_plans/special_course/trustworthy_offline_rl_thesis_first_sprint_2026_v2_replanned.md
```

For a deliberately partial change, use `mode = "patch"` and:

```sh
make plan-patch PATCH=/absolute/path/to/my_course_patch.md
```

Matching IDs preserve task progress, notes, annotations, discussions, and time
entries. Full syncs soft-delete removed structure; patches never remove omitted
rows. Preserve stable day/task IDs whenever their progress and linked content
must survive a plan revision.

## Daily Workflow

- Use Roadmap for task state, linked source opening, task notes, defer flags, and
  day notes. Questions and PDF captures are grouped compactly by resource and
  chapter directly below their linked task; open an individual capture only
  when its context or actions are needed. Skills belong to the day and are not
  repeated on every task. The compact clipboard-picture action imports the last
  five Maccy images as resource questions scoped to the current study day; the
  adjacent file picker imports explicitly selected note screenshots. Both flows
  preserve the original image for QA and tutor prompt attachments.
- Use Resources for grouped library progress, source opening, resource notes,
  reading state, PDF comment/highlight collection, and resource-linked
  discussions. Every source has a visible Ask action and an inline question
  shelf. Markdown, HTML, text, code, JSON, and CSV files open in the in-app
  reader; select text there to save a highlight or structured question.
  **Copy questions** opens one resource-scoped discussion and copies only
  questions that do not yet have a tutor response. For books the queue ignores
  study-day boundaries and is ordered by chapter, page, and position. Its
  chapter map and QA workspace aggregate existing answers from earlier day
  discussions by canonical annotation UUID, so no answer text is duplicated.
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
  with reference, partial, and done controls. QA review also has a
  non-destructive **Skip** state: it preserves the question and every tutor
  answer, does not claim understanding, and removes the question only from
  active/new review queues; **All answers** can reopen it later. Deleting a discussion is a
  recoverable soft deletion rather than destructive database removal.
- **Copy review** exports a question-centric version of the current discussion:
  original captures, personal notes, answer rounds, follow-ups, and important
  marks remain grouped by their stable annotation UUIDs. The reusable requests
  appended to day prompts and discussion reviews live in
  `frontend/src/config/promptTemplates.json`; editing them requires only a
  frontend rebuild and service restart in production. See
  `frontend/src/config/README.md` for the exact workflow.

For Maccy history import, macOS must allow the tracker launcher to read Maccy's
container. Grant Full Disk Access to Terminal/iTerm/the service runner and
restart it, or use the manual picture picker. Override the default Maccy store
with `TRACKER_MACCY_DATABASE_PATH` in `backend/.env`. The UI confirmation for a
prompt with more than 20 questions reports the actual attachment-file count as
well as the question count; choosing the short form still limits the prompt to
its first 20 questions.

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

After editing a full plan, load it with `make plan-update PLAN=...`. For a
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

### Local and iCloud PDF annotations

Resources without a Drawboard Cloud URL collect directly from their configured
local `path`, including iCloud Drive files edited in Drawboard on iPad. Let iCloud
finish syncing before collecting. No Drawboard Cloud account or upload is used.
The PDF must contain editable annotation objects; flattened pen marks are page
artwork and cannot be recovered as individual annotations by this importer.

- Embedded highlights retain both the marked text and any attached comment.
- Handwriting, shapes and stamps retain their native PDF appearance in screenshots.
  Nearby handwriting is grouped using vertical guides; red groups are questions,
  and other ink becomes notes. Typed `??` and `todo!` also flag questions.
- Recollection preserves saved question identities, answers and user-authored
  notes. Closed questions keep their original screenshots; open ones refresh.
  Source deletions soft-delete imported captures without deleting their documents.
- IDs are scoped to PDF pages, including a safe upgrade of older imported IDs.
  A PDF changing during collection aborts before source reconciliation.
- Opening a PDF in Drawboard and parsing its bytes are separate permissions.
  The app hosting the tracker process needs macOS access to the local iCloud files.

Red cloud ink is treated as a question. Drawboard's bottom-origin ink
coordinates are converted to the PDF's top-origin page geometry before the
tracker renders a full-width crop, overlays the cloud stroke in its exact RGB
colour, and keeps generous vertical margin around it. Other ink remains counted
but skipped because it has no searchable text. Exact annotation RGB values are
preserved for UI accents; the coarse colour names remain available only for
question/type rules.

The anonymous sharing credentials are cached with owner-only permissions in the
gitignored `drawboard_state.json`. Generated handwriting crops live in the
gitignored `data/annotation_images/` directory and are served only
by the local tracker API. QA review also keeps high-resolution annotated page
images for question pages and their annotated neighbors. These use the same
Drawboard appearance data as the focused crops, so highlights keep their
opacity and handwriting is visible beside the clean PDF text layer.

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
root-scoped headings such as `Q-b-05-009-F1`; original copied questions keep
their immutable labels such as `Q-b-05-009`. This makes follow-ups and newly
copied questions safe to combine in one tutor request. The annotation UUID is
the canonical database identity, while the readable label is assigned once to
the logical question and remains stable across tasks, discussions, copies, and
answer versions. Historical prompts that used discussion-local `Q-###` aliases
remain resolvable within their original prompt batch. Repeated tutor answers
under one exact heading become editable, independently deletable answer versions
on the same QA page.
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

Book tasks whose title names exercises expose **Screenshot solutions**. This
uses the task's exercise numbers only to identify the book chapter, then scans
all Drawboard handwriting in that chapter. Each vertically connected notation
group becomes one high-resolution, full-width screenshot; every exercise
heading inside that group labels the same screenshot and is marked covered, so
adjacent exercises joined by one margin line are not cropped or exported twice.
A group continues onto the next page only when its notation reaches the current
page bottom and resumes at the next page top. The crops are written to the same
ChatGPT attachment directory. Unmarked exercises are skipped silently, so doing
extra chapter exercises includes them without attaching unrelated reading
notes.

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

Transparent animal GIFs live in `gifs/`. Task and perfect-day effects are
configured in `pet_animations.json`; the task preset defaults to one small
scampering pet, while a fully completed day uses a short multi-pet firework.
Change the animation, number of copies, duration, or size without touching the
Roadmap component.

Open `/?petLab=1` (or use **Pet animation lab** at the bottom of the sidebar) to
test every GIF with the `scamper`, `parade`, `orbit`, `bounce`, and `firework`
motions. The lab has task/day presets, live size/copy/duration controls, a full
GIF-by-motion matrix, and a copyable JSON preset.

The current architecture is documented in `docs/architecture.md`.

Useful checks:

```sh
make backend-check
make lint
make build
make check
```

## Plan rule

Edit the Markdown plan or registry, validate it, then use `make plan-update
PLAN=...` for a guarded replacement or `make plan-patch PATCH=...` for a partial
change. The app does not read or regenerate `tracker.html`.
