# Tracker feature and maintenance log

## 2026-09-25 — reading view for discussion answers

- Discussions default to **Reading**, showing the original question/capture and
  a rendered tutor excerpt, with quieter separators. **Compact** retains the
  earlier list. Resource/chapter Q&A entry points, global pins/priority ordering,
  filters, full responses, and Q&A sequence are preserved.
- Excerpts use complete Markdown blocks rather than slicing formulas or fences;
  priority preambles are omitted from excerpts only, and reference links retain
  their definitions. Full answers remain unchanged. Long excerpts scroll within
  a bounded area and have a Read full answer control.
- Validation: all 265 frontend tests, ESLint, TypeScript/build; browser checks of
  real Day 15 questions, search, display switching, full math answers, and narrow
  layouts. Existing large-bundle build warning remains a performance TODO.

## 2026-09-25 — preserve time during API errors and zero-length entries

- Non-quota HTTP failures now keep the last successful day/task snapshot, just
  like network failures. A zero-second entry without a stop timestamp is treated
  as finished, preventing phantom running time. Validation: 85 backend tests
  covering synchronization, local integrations, workspace mutations, and reviews.

## 2026-09-25 — focused task-review copying and clearer task actions

- **Copy for tutor** opens a preview with an editable review heading, whole-note
  section selection, optional task instructions/resource notes/prior reviews,
  and a scratch copy editor. Interleaved checklist answers stay together by
  default; saved notes never change. Complete prior review markers are excluded
  by default; malformed markers retain their content. Attachments are prepared
  on copy using the existing question IDs and note-image packaging.
- Imported reviews use the task title in discussion listings and Q&A. The
  existing review/answer selection dialog is preserved.
- Task facts and shortcuts have distinct rows, with all existing actions still
  visible. Remaining core work excludes skipped/completed/optional tasks; Next
  step opens and focuses the next actionable task. An externally resumed timer
  can now be stopped even on a completed task.
- Validation: copy-source and remaining-work tests, seven backend review tests,
  ESLint/TypeScript/build; desktop and phone-size preview checks with Day 15's
  real interleaved answers, math, prior-review selection, and cancellation.

## 2026-09-25 — overlapping highlight paint correction

- The reported CQL paragraph has two genuinely overlapping blue captures. The
  old opaque split-colour gradient drew dark bands through wrapped text. Overlaps
  now use a single translucent blended fill, with no inset stripe; each capture
  remains accessible by clicking the shared highlight.
- Unmatched extracted quotes no longer paint an entire context sentence as if
  it were highlighted. The capture-count control still exposes every capture.
  Tests cover the overlap style and this conservative matching fallback.

## 2026-09-25 — read annotations as a highlighted document

- Annotation shelves now default to **Reading**: full captured paragraph context,
  quiet page/chapter markers, and original highlight colours. Single captures
  retain paragraph context too; captures follow page, detected column, and position.
  Drawboard's bottom-origin coordinates are normalized before ordering.
- Click or keyboard-activate a highlight to reveal its capture controls. Overlaps
  reveal all matching captures; unmatched highlights retain a capture-count button.
  Notes, answers, postpone, discuss, and archive remain available. Stars mark
  important captures using the existing High capture priority field.
- **Cards** preserves the previous management view; question-focused shelves
  still start there. Switching displays or closing controls retains mounted note
  editors. Handwriting crops remain visible.
- Validation: interaction tests for overlap, normalized text, single paragraphs,
  importance/archive callbacks, and view switching; TypeScript and ESLint.

## 2026-09-25 — reconcile external Toggl timers within a request budget

- Routine fresh snapshots now reconcile task time as well as day totals. Phone/
  desktop restarts reuse a unique exact-description binding; ambiguous titles
  remain day time. Remote changes/deletions still reconcile by entry ID.
- Ten-minute default server cache, visible-tab polling, explicit header sync,
  persistent 24/hour local budgets, and non-bypassable HTTP 402/429 backoff.
  Successful starts survive a failed follow-up read; invalid/full snapshots
  cannot erase mirrors. Last successful sync is available in the button tooltip.
- Validation: 76 backend integration/mutation tests, frontend TypeScript and
  ESLint. Tests use fake Toggl responses; no live timer commands were sent.
- See [audit and limitations](study-flow-audit-2026-09.md); the following study
  flow entries record annotation, task, and review improvements.

## 2026-09-24 — safer question IDs and task-note review controls

- Context shared across a PDF page break no longer merges new questions: stable
  IDs are reused only on the same page and in the same detected column. The
  reported p. 23/p. 24 pair was repaired as Q-p115e98-00-006/007 while retaining
  its two tutor answers and viewed state. The intentionally shared p. 4 pair is
  unchanged.
- Tasks with current-day resource annotations gain **Copy + notes**. Resource
  notes use N-… labels and carry their saved crop or PDF-page screenshot without
  becoming QA questions; the normal task-copy action remains unchanged.
- Highlights-only reading is remembered per saved note until **Show full note**
  is chosen. Formula atoms now have a small inline/display control and
  `Cmd/Ctrl+Shift+M`; conversion also joins or splits surrounding prose spacing.
- Fixed the intermittent white page when a read-only note entered edit mode. The
  editor now compares ProseMirror documents by identity instead of recursively
  traversing the two editors' cyclic schemas.
- Validation: full backend suite, all 256 frontend tests, ESLint, TypeScript,
  production build, and browser reproduction of the former editor crash.

## 2026-09-24 — connected RL algorithm map for Day 12

- TORL gains **Algorithm map**: 27 authored nodes, 38 labeled relationships,
  12 cross-paper mechanisms, the five-method decision matrix, and an interactive
  score/pathwise/critic-gradient demonstration. Original SAC and later SAC remain
  separate, with source/version boundaries and personal question themes.
- Paper-style procedures use numbered lines and nested indentation. Explanations,
  symbol guide, and paper notation are optional. Mechanism links open another
  procedure with matching steps highlighted. Expanding a procedure scrolls to its
  heading, including on narrow screens; long equations scroll within the card.
- [JSON/Markdown editing workflow](../content/rl-map/README.md) and
  [research scope](../content/rl-map/RESEARCH.md) document extension and coverage.
  The build validates formulas, node/edge/mechanism references, and sections.
  Content is bundled locally; map preferences do not write study records.
- Validation: all 250 frontend tests, including every card in both notation
  conventions and numerical gradient checks; ESLint, TypeScript, production
  build, and fresh-content check. Browser checks covered 1440px/390px layouts,
  mechanism navigation, controls, source-reader link, and existing Roadmap,
  Resources, and Exams. No new console errors or page-level horizontal overflow.
- Limit: saved text annotations and tutor discussions were available, but direct
  annotated iCloud PDF access was denied. The map is a curated synthesis, not a
  complete transcription of handwriting; sources remain linked for review.

## 2026-09-22 — tutor labels take precedence over legacy capture flags

- Live-data verification found imported High capture flags masking explicit tutor Core labels. Unset study priorities now prefer tutor guidance, retaining legacy High/Low only as a fallback. New manual Q&A choices remain authoritative; Auto removes that fallback. Existing capture data is unchanged.
- Validated precedence and Auto regression tests, discussion model tests, lint and production build; confirmed the combined overview on the running app.

## 2026-09-21 — preserve literal math syntax on the first parse

- Display-math and metadata token hints now start only at block boundaries.
  Inline-code examples such as `$$…$$` no longer split prose into fake formulas.
- Validation checks the intended initial document, including a literal guide
  with zero formula nodes, as well as repeated save/reopen. The automatic Debug
  check cannot by itself detect corruption already present in the first parse.
  All 233 frontend tests, TypeScript, ESLint and the production build pass;
  the guide's corrected first render was verified in the browser.

## 2026-09-20 — text-only PDF highlights remain questions

- Question-colour text highlights now import as questions with their extracted
  text, while screenshots remain limited to handwriting and other visual marks.
- Recollection upgrades previously misclassified highlights in place and removes
  stale image metadata from text-only questions without changing answered state,
  annotation IDs or stable question identities.
- Validation: local and Drawboard connector regressions cover text questions,
  screenshot suppression and ID-preserving repair; the full backend suite passes.

## 2026-09-20 — course-note guide and practice workspace

- **Debug → Note playground** provides Markdown beside the shared visual editor
  (stacked on narrow screens), a realistic editable course note, an in-app guide,
  `.md` downloads and a save/reopen integrity check. Visual edits update source;
  Apply Markdown explicitly parses source edits without reparsing partial input.
- Practice drafts persist in local browser storage, including unapplied source;
  browser-storage failures are visible. Load example/Start blank can be undone.
  This workspace does not change course notes or create Q&A records.
- [Writing guide](editor-guide.md) covers prose, supported Markdown extensions,
  LaTeX, boxes, highlights, code, tables, checklists, images and tutor workflows.
  [Course-note example](course-note-example.md) exercises the supported features.
- Validation completed September 21: all 233 frontend tests, ESLint, TypeScript
  and production build; actual guide/example integrity checks, React tests for
  apply/echo/reset/draft retention, and desktop/narrow-window browser checks.
  The browser worker successfully checks the complete example.

## 2026-09-20 — formula controls and highlight excerpt consistency

- Formula actions stay with the toolbar; the preview dialog wraps and scrolls
  on small windows. Stale dialogs refuse Apply/Delete after external document
  replacement. Highlighted code uses readable dark text.
- New review highlights live in the document, avoiding stale duplicate queued
  annotations when recolouring/removing them. Highlights-only excerpts include
  code/math blocks and ignore literal marker strings inside code and formulas.
- Validation: 15 focused React/excerpt tests, TypeScript/ESLint; browser checks
  for boxed highlighting, conversion, keyboard deletion/undo and code colours.

## 2026-09-20 — selectable formulas and persistent box highlights

- Formulas select on click; Enter/double-click opens a previewing LaTeX editor.
  Delete/Backspace and explicit Delete remove them; To inline / To display and
  undo preserve prose and colours. Unsupported table/blank-line conversions
  explain why they cannot be applied.
- Highlights cover rendered formulas (including `\boxed`), inline code, and
  whole code/display-math blocks. Block colours use an ignorable
  `<!-- note-highlight:yellow -->` comment immediately before the block; no DB
  migration. Mixed selections use one transaction; integrity checks include
  block colours. Code fences containing backticks now survive serialization.
- Validation: all 225 frontend tests (43 editor/integrity), TypeScript and ESLint. Architecture,
  syntax and remaining limits: [editor audit](editor-audit-2026-09.md).

## 2026-09-20 — prioritize QA answers and tame follow-ups

- Tutor answers now receive conservative Core/High/Medium/Low badges from
  explicit priority wording. A durable manual priority control is available in
  QA review; discussion answers sort by pinned state and priority without
  changing the normal QA review order. Important answers reuse the existing
  note links and appear pinned in purple.
- Day discussions group answers into compact resource cards. Completed
  follow-ups can be marked done, collapse into a green row, and remain
  expandable or reopenable. Structurally mapped follow-up answers are excluded
  from the next tutor prompt even when cached counts lag, and newly selected
  follow-up source text is saved with the question highlight colour.
- Validation: 213 frontend tests, ESLint, TypeScript and the production build.

## 2026-09-19 — preserve paragraph grouping for text questions

- Screenshot frame reconciliation now applies only to visual questions. Text
  questions in one paragraph retain their shared readable identity and grouping
  in review/Q&A, without an unnecessary per-capture frame ID.
- Validation: paragraph-context integration test runs for both regular highlights
  and question-colour highlights; local/cloud import and frame regressions pass.

## 2026-09-19 — one annotation policy for local PDFs and the cloud book

- Local/iCloud and Drawboard Cloud connectors now feed one classifier, colour
  palette, grouping rule, import command and persistence loop. Regular-colour
  handwriting/shapes stay in the PDF; regular text notes/highlights still import.
- Question-colour highlights and handwriting connected by overlapping Y ranges
  on the same page become one screenshot question, including transitive overlap
  across columns. Highlight text remains searchable metadata. Real vertical gaps
  stay separate; paragraph grouping remains available in the review UI.
- Course colour choices, explicit `??`/`todo!` text markers, historical question
  IDs, manual notes, answers and closed screenshots are preserved. Legacy book
  frame aliases remain compatible. The source PDF is never edited.
- Validation: shared connector parity tests, exact/transitive overlap, custom
  colours, ignored bridging ink, repeat imports, palette confirmation, rollback,
  identity retention and the historical book frame fixture. Full backend suite,
  Ruff, strict mypy and frontend production build pass.
- Backed up and transactionally replaced the 51 unreviewed Day 12 PPO captures:
  6 question groups and 15 regular highlights; 100 regular visual source marks
  ignored. Archived two obsolete copied prompts (no tutor answers were linked).
  A repeat import found all 21 existing with zero changes; foreign keys are clean
  and unrelated rows across all 44 ordinary tables matched before/after.
  Native screenshots were visually checked for combined handwriting/highlights.

## 2026-09-18 — share pen-colour rules between local and cloud PDFs

- Real PPO-file preview exposed a local-only bug: Drawboard's dark-red pen was
  classified as a note. Both import paths now share the cloud importer's hue
  rules, including dark red and pink while excluding neutral and blue ink.
- Validation: 38 local/cloud tests, including five matching-palette cases and
  a dark-red guide/handwriting group; Ruff and strict mypy. The real preview
  revealed 51 captures after final recollection. The unwanted regular handwriting
  and split question groups are corrected by the shared-policy entry above.

## 2026-09-18 — preview PDF collection without changing study data

- `POST /api/resources/{id}/pdf-annotations/collect?dry_run=true` runs the full
  importer in a rolled-back savepoint and returns `dry_run: true`. Generated
  preview images may be cached, but captures, identities, notes and deletions are
  rolled back, including on errors. Logs explicitly identify the rolled-back run.
- Validation: 13 local integration tests, including snapshots of all ordinary
  database tables before/after preview, partial-failure rollback and a subsequent
  normal import; Ruff and strict mypy.

## 2026-09-18 — distinguish PDF permissions from parsing failures

- PDF reading and local annotation import now probe file-content access and show
  an actionable permission/download error instead of a generic parsing error.
  Opening in the external PDF app remains independent, since Drawboard may have
  access while the tracker process does not. Failed reads do not import anything.
- Validation: 59 targeted resource, import and workspace tests; Ruff and strict
  mypy. Tests explicitly cover external open succeeding while parsing is denied.

## 2026-09-18 — import embedded local/iCloud handwriting

- Local PDF collection now imports handwriting and visual marks as native PDF
  screenshots and keeps highlight comments as well as quotes. The initial import
  incorrectly kept regular handwriting as notes; superseded by the shared policy above.
  Local screenshots use the same review presentation as cloud screenshots.
- Reimports preserve answers, manual notes and historical closed-question images.
  Page-scoped IDs prevent repeated PDF annotation names from overwriting captures
  on other pages; old IDs upgrade in place. Concurrent file changes and preview
  failures abort collection before reconciliation. Source PDFs remain untouched.
- Validation: local/cloud regression tests, native rendered pixels at all four
  page rotations, immutable image caching, recolouring, guide removal, source
  deletion, repeated IDs and legacy migration. 220 backend and 209 frontend tests
  passed, plus Ruff, strict mypy, frontend lint and a typechecked production build.
- The tracker started from the user's Terminal can read the actual iCloud PDF.
  The supplied iCloud link requires Apple Account sign-in; collection uses the
  local file. Initial live imports are superseded by the correction above.

## 2026-09-18 — allow the linked iCloud papers directory

- Added explicit `resource_file_roots` in `course_files.json`, including the
  iCloud thesis papers folder. Opening, PDF reading and annotation collection
  share the same allowlist; spaces need no shell escaping. Existing helper roots
  remain supported, and resolved symlinks/traversal cannot escape allowed roots.
- Validation: 51 resource/local integration/workspace tests, Ruff and strict
  mypy; added coverage for spaces, PDF rendering/extraction, relative/home roots,
  malformed configuration and three escape attempts.
- Actual iCloud collection works through the tracker started in the user's
  Terminal, which has file access; Codex's own process remains unable to read it.

## 2026-09-18 — meaningful sidebar progress and course map

- Progress and Course map are separate remembered sidebar summaries. Progress
  shows completed core work, optional wins, understood questions, mapped answers
  ready to review and completed to-dos, plus a reachable next task milestone.
  Reading/skills/exam totals remain available under an expandable summary.
- Counts come from current task and logical-question state: cancelled work is
  excluded from targets, optional work is separate, companion captures count once,
  and mapped responses do not become understanding until marked answered.
- Replaced the misleading course-index "day streak" with a labeled course-day
  map: readable numbered tiles, click-to-navigate, current-day outline, core
  completion checks, study-time investment and clear activity colors. Empty/rest
  days do not invent activity from stale ratios or planned dates.
- Sidebar time now follows the same current per-day data as Roadmap. Fixed rounded
  values such as `1h 60m`. No new action/content logging or data migration needed.
- Validation: 206 frontend tests, lint and typechecked production build; browser
  checks on a data copy for summary switching, map navigation, reader template
  and caret, desktop layout and tablet layout. Includes 12 new achievement/model
  tests for cancellation, duplicate captures, to-dos, milestones and saved updates.

## 2026-09-18 — slide capture template and stable caret

- New PDF reader captures begin with `/screen ` so slide questions include their
  source image by default. Remove the tag for text only. A bare template cannot
  be saved. Question/to-do shortcuts and questions inferred from `??` retain it.
- Focus and selection are initialized once after the textarea receives its value;
  the first typed letter stays before the caret and later edits keep their position.
- Validation: 8 reader/capture/progress tests, including caret position, first
  character, repeated captures, template-only drafts and screenshot opt-out; lint.

## 2026-09-18 — copy only unanswered follow-ups

- Follow-up copying now uses the shared question queue: an existing mapped tutor
  response excludes the whole logical question even before it is marked understood.
  Legacy inline markers cannot reintroduce persisted captures or duplicate them.
- Validation: regression cases for mapped-but-open questions, companion captures,
  resolved inline markers, and returning to the queue after answer removal.

## 2026-09-18 — task administration UI and patch handoff

- Roadmap has a separate Manage tasks mode and a per-day maintenance button.
  Search all tasks (including cancelled duplicates), rename, change status/time,
  attach or detach library resources, toggle optional work, delete and restore.
  Every mutation is previewed and uses the backed-up administration API.
- Added change history, visible before/after details, backup receipts, and the
  canonical Patch guide with copy controls. Copy day context exports stable IDs
  and metadata without study content, including days with no remaining tasks.
- Unsaved changes require an explicit discard; failed saves retain drafts and
  reuse the same request ID. Refresh failure after a successful save does not
  resubmit it. Running timers block cancellation/deletion. Protected manual
  edits can be released explicitly for future patches.
- Validation: 204 backend tests, 187 frontend tests (11 administration tests),
  Ruff, strict mypy, frontend lint/typecheck/build. Browser checks on a copied
  database covered rename/resource attachment, duplicate deletion and restore,
  unsaved changes, history, guide, and 390px layout. Study content and foreign
  keys remained intact; no live task cleanup was performed.
- Deployment: fresh database backup, rebuilt frontend and restarted the persistent
  service. Health, administration and guide endpoints passed; live task/content
  rows match the backup and no administration mutations were made to live data.

## 2026-09-17 — keep optional resource links consistent

- Administration optional/core changes now update attached resources' required
  flags in the same transaction, including resources attached in that edit.
- Validation: regression test toggling optional/core, backend Ruff and mypy.

## 2026-09-17 — canonical patch reference and exported identities

- Added [the complete patch reference](plan-patching.md), served read-only by the
  API for the forthcoming administration UI. Covers additions, edits, deletion,
  cancellation, notes, resources, moves, order, status replay, backups and recovery.
- Patches accept exported task/day/resource UUIDs and section UUIDs, with ownership
  validation. Renaming a section using its exported ID preserves the same section;
  exported IDs no longer accidentally become new tasks or unknown day aliases.
- Validation: 42 focused administration/deletion/reference tests, including complete
  guide examples and UUID edits without duplicate rows; backend Ruff and mypy.
  UI navigation/copy controls were delivered on September 18.

## 2026-09-17 — explicit patch deletion and resource detachment

- Patches accept `- [ ] Duplicate {#existing-task-id delete=true}`. Deletion is
  distinct from cancellation, preserves study content, and uses administration
  history/restore. It requires an existing task in the declared day and cannot
  combine deletion with note or metadata changes. Full-plan deletion directives
  are rejected. Replaying deletion is harmless; ordinary patches cannot revive it.
- Real deletion patches always make a backup, including direct service calls.
  Preview rolls back task removal and audit records without creating a backup.
- Explicit `resources=""` now detaches resources from a task; omitted resources
  preserve links. Shared resources and their annotations/progress are retained.
- Validation: 58 administration/patch tests, backend Ruff and full strict mypy.

## 2026-09-17 — task administration data safety

- Added revision-checked task edit, removal, restore, and patch-protection release
  endpoints. Each real change requires a successful SQLite backup and records a
  local before/after receipt in the same transaction. Retried request IDs are
  idempotent; stale edits and cross-course resource links fail without changes.
- Removing a task hides it from normal tracker views while keeping its notes,
  tutor history, resource data, and time records. Restore preserves its identity;
  a running timer prevents removal/cancellation. Cancelling uses skipped status.
- Patches reject attempts to revive an administratively removed task or overwrite
  protected edited fields. Full plans also reject removal of protected tasks.
  The corresponding administration UI was delivered on September 18.
- Validation: administration and patch-integrity regression tests, backend Ruff
  and strict mypy. Includes backups, rollback after failed writes, stale edits,
  idempotency, resource ownership, timer guards, restoration and patch conflicts.

## 2026-09-17 — local agent instructions

- Moved agent-only operating instructions to an ignored local folder and removed
  them from tracked files. An ignored root link preserves automatic discovery.
  Developer documentation and product references remain in `docs/`.
- Validation: checked the local link, Git ignore rules, and staged paths.

## 2026-09-17 — commit completed changes promptly

- Repository instructions now require a focused commit for each completed change,
  including relevant tests and a feature-log entry, after its checks pass. Keep
  local data and build artifacts out of commits. Validation: documentation diff.

Keep a concise record of behavior, special handling, known gaps, and validation.

## September 2026 — editor and discussions (delivered)

- Shared rich Markdown editor for task/day notes and discussions; source mode,
  tables, images, headings, direct section editing/deletion, recoverable drafts,
  and visible save failures. Preserve math, adjacent spaces, and numbered lists.
- Tutor import handles standalone notes and protects math/code from question
  parsing. Standalone tutor messages can become Q&A review sources with follow-ups.
- Validation: 135 frontend tests; 42 focused backend tests; frontend typecheck,
  lint, and production build. Full backend mypy has preexisting PDF-service errors.
- Details and remaining editor limitations: [editor audit](editor-audit-2026-09.md).

## 2026-09-15 — daily plan patches

- Exclude skipped tasks from planned time; show active optional time separately.
  Resumed/completed tasks in a Cancelled section appear in expanded Restored work.
- `::: task-note {#task-id}` blocks supply full Markdown to the normal task note.
  Omitted/unchanged source preserves editor work; conflicting edits reject the patch.
- Strict parsing, transaction rollback, schema checks, safe ordering, automatic
  CLI backups, and a rollback-only preview. Preserve progress on patch replay.
- Omitted dates/metadata survive patches; partial day skills merge; typoed day
  IDs cannot alias an existing day. Explicit order swaps work; occupied slots
  fail. Inspection is read-only and prints all task statuses accurately.
- Backups reserve filenames atomically and never overwrite another backup.
  The convenience runner previews before applying, keeps Downloads originals,
  rejects conflicting destination files, and requires a named patch.
- Day 10/11 live transaction previews passed without applying either patch.
  Day 10's older crash patch includes two example Markdown task-note blocks;
  it was not reapplied over the user's newer cleanup plan.
- Known database quirk: legacy external-content FTS tables cannot be queried with
  `SELECT *` for snapshots; integrity tests snapshot physical tables instead.

## 2026-09-15 — task tutor review

- Copy task title/info, full note, and linked questions, including answered
  questions and directly attached note/review follow-ups. Stable labels retained.
- Insert review previews heading choices; checked sections append to the task
  note, other sections need an exact mapped Q label. Unknown sections stay visible.
- Tagged reviews synchronize edits/deletes between note and Q&A in one transaction.
  Stale revisions, invalid boundaries, and reused import IDs fail safely; retries
  of the same import do not duplicate it. No filesystem exports during task import.
- Q&A shows a fixed original-work snapshot at left and editable feedback at right;
  narrow windows stack panes. Existing highlighting, Ask, and review status apply.
- Copy/Insert/Q&A survive compact completed-task styling; unsaved note edits
  disable Copy/Insert. Import supports keyboard focus containment and Escape.
- Resource-free task notes can create `??`/`todo!` captures under Task notes.
  Direct task questions/reviews and follow-ups count toward the owning task/day.
- Known limits: manually pasted older reviews remain ordinary note content;
  snapshots are taken at insertion; question-only imports use their existing
  endpoint; external rich-text apps may drop review-boundary comments.
- Validation: 141 frontend tests; 76 focused backend tests; frontend lint/typecheck/
  build; targeted backend Ruff/mypy. Browser tested Day 11 import and Q&A using an
  isolated database copy. Build retains the existing large-chunk advisory.
- Full syntax, semantics, guarantees, and TODOs:
  [daily patches and task tutor reviews](plan-patches-and-task-reviews.md).

## 2026-09-16 — insert diagnostics and historical editor repairs

- Debug tab (Option–7): daily paste/save records, original/import/save/reopen
  comparison, automatic formatting/formula checks, issue flags, and feedback.
  Navigation icons keep accessible labels and tooltips when the sidebar is collapsed.
- Review keeps only an explicit minimal regression fixture and deletes the full
  record. Seven-day expiry, 500-record/20-MB cap, separate storage outside study
  backups, secure deletion. Exported fixtures run in the real-editor test suite.
- Replaced inline serialization and fixed ordered/loose-list parsing, custom
  highlight imports, and inconsistent preview rendering.
- Audited 670 current documents and repaired 24 in place, preserving revision
  history and links. Backed up and guarded the batch against concurrent edits.
- Fixed SQLite backup handling for WAL sources with missing sidecar files.
- Validation: 161 frontend tests, frontend lint/typecheck/build, focused backend
  tests (55) and Ruff/mypy, real-browser checks on an isolated database.
- Workflow, retention, repair details, and limits:
  [insert diagnostics and repair audit](editor-debug-and-repairs.md).

## 2026-09-16 — discussion discovery, deletion integrity, and temporary usage capture

- Course-wide question/answer finder, status/source filters, previews with math,
  logical-question grouping, historical aliases, and direct Q&A or message opening.
  Search includes unread responses and retained unlinked answers.
- Fixed final-answer empty shells, full-conversation cleanup, shared-answer and
  archived-question status preservation, stale-revision protection, dead “Go to
  answer,” new-thread focus, and false deletion-success UI.
- Migration 0025 retires only unequivocally empty, unlinked historical messages;
  source documents and revision history are preserved.
- Read-only Q&A no longer creates conversations; cross-scope task/resource answers
  are reachable; Notes opens the selected question; task prompt/import labels are
  explicit; first Copy next prepares its thread and empty queues create nothing.
- Debug → Usage & friction records three days of local content-free action metadata,
  expires events after seven days, supports stop/delete/export, and summarizes view
  time, searches, repeats, sequences, and request failures/latency.
- Validation: 166 frontend tests and 56 focused backend tests; frontend lint,
  typecheck/build; changed backend Ruff and usage-service/route mypy. Browser checked
  finder → matching Q&A → retained search, empty results, math previews, conversation
  filtering, no blank cards, and usage summary. Existing build chunk-size advisory remains.
- Deployed to the local service. Migration retired 16 empty shells, left all 12 active
  threads intact, and passed foreign-key validation. Backup:
  `data/backups/tracker_v2-20260916-134439-361267.db`; metadata-only audit:
  `data/discussions-audit-2026-09-16.json`.
- Details, entry-point map, privacy boundaries, and known limits:
  [Discussions audit](discussions-ux-audit-2026-09.md).


## 2026-09-16 — formula display, Q&A navigation, and readable note workspaces

- Fixed duplicate formula/symbol display on cold note loads: KaTeX CSS now loads
  with the app instead of depending on the lazy Markdown reader. The reviewed
  insert's stored Markdown was intact; no note-content rewrite was needed.
- Debug now checks for an exposed formula accessibility layer as well as text,
  marks, structure, and math round trips. Retained only a minimal synthetic paste
  fixture after resolving the reviewed report; full reviewed payload is deleted.
- Q&A group buttons use book sections, resource titles for mixed lecture sources,
  and page numbers within a single lecture. Counts still merge logical captures
  and inherit follow-up locations. Clicking a completed group switches to All
  answers when necessary. Group clicks enter the existing content-free usage log.
- Day and task notes share reading/writing controls: 18px default text, 16–22px
  browser-local size preference, heading navigation, bounded reading width, and
  More space without remounting an active editor or losing undo. Day notes open
  in reading mode; Edit note is available at the top. Existing note content and
  progress are preserved. Lecture slide-outline inference remains out of scope.
- Validation: 173 frontend tests, lint/typecheck/production build; three usage-log
  backend tests and Ruff. Isolated-browser checks covered cold-load CSS, direct
  paste/save/reload with bold and formulas, Day 11 heading jumps, mixed-resource
  Q&A navigation, completed-group filter switching, and lecture page labels.
  The existing production chunk-size advisory remains.

## 2026-09-17 — repeat reading, understanding progress, and visible to-dos

- Lecture reading and Q&A now have fresh per-opening reading passes, animated bars,
  quarter milestones, remaining counts, and New pass. Saved reading/review history,
  understood statuses, and note drafts remain intact. Pass counters are local to
  the open reader and reset on reopening; they are not durable study records.
- PDF passes count distinct loaded slides after a short viewing interval, so
  revisiting one slide or jumping to the last does not complete the whole pass.
  Saved lifetime progress still retains its high-water mark.
- Q&A separately tracks the questions open at the start of the understanding pass.
  Credit follows confirmed workspace status changes; skipped/later questions do
  not prevent completion. An empty queue offers Read all answers again. Reading
  totals stay stable when understanding a question removes it from the Open filter.
- Day/task summaries retain to-do done/total and open/later/skipped counts, including
  closed days and completed tasks. Questions and to-dos have distinct labels.
  Day-note to-dos also count without a resource or task link. Escaped `!!todo!!`
  markers are recognized without rewriting the authored note.
- Unspecified book tasks inherit explicit chapters from non-skipped tasks of the
  same day and book. Explicit scopes win; per-resource chapter maps prevent a
  chapter from leaking into another book. Day 11 Hand derivation resolves to 13.
- Deployed to the local service. Restored the two confirmed missed note to-dos,
  including Day 11's Berkeley revisit; original note contents and revisions are
  unchanged, and foreign-key checks pass. Backup:
  `data/backups/tracker_v2-20260917-113643-716573.db`. Live API verification reports
  one open Day 11 to-do and Chapter 13 for Hand derivation.
- Validation: all 176 frontend tests and 161 backend tests, frontend lint and
  production build, backend Ruff and full mypy (48 files). Isolated browser checks
  covered a second lecture pass, repeated slide visits, fresh Q&A passes, completed
  queues, confirmed +1 understanding progress, closed-day to-do visibility, and
  Day 11 source scope. Existing Vite
  large-chunk and dependency deprecation advisories remain.

## 2026-09-17 — pending-change audit and integration

- Traced the pending editor/discussion work against the neighboring tracker tasks
  “Audit discussion editor and parsing,” “Optimize annotation parsing and QA,” and
  “Finish tracker web app,” and the latest committed PDF/frame fixes. The pending
  stack includes the plan-patch/task-review workflow, annotation performance and
  immutable captures, editor repairs/diagnostics, discussion search/deletion,
  temporary usage logging, note workspaces, and the progress/to-do changes above.
- Retained all pending tracker source, tests, fixtures, documentation, dependency
  locks, and helper scripts. Machine-local databases, credentials, diagnostics,
  backups, dependencies, and build outputs remain ignored. Credential-pattern
  scanning found no matches in pending files. Raw paste fixtures retain original
  trailing spaces (including Markdown hard breaks); a scoped Git whitespace
  attribute preserves these test inputs. The remaining diff passes whitespace checks.
- Resolved 12 older PDF type-check failures without disabling strict checking:
  narrowly annotated untyped library calls, removed a duplicate declaration, and
  made a validated four-coordinate crop tuple explicit.

## 2026-09-19 — column-aware PDF captures and approved Zotero exports

- PDF collection now detects two-column pages from extracted text geometry and
  partitions question marks into logical left/right/full lanes before applying the
  same transitive Y-overlap grouping. Uncertain/full-page layouts keep the old
  cross-page-width behavior. The real 10-page function-approximation paper detects
  two columns throughout and no longer merges aligned left/right notes.
- Standalone question-colour highlights now import their text without producing
  screenshots. Near-touching pen fragments and gutter-crossing handwriting are
  assigned to one logical note; this removes the observed duplicate capture pairs
  on pages 2, 6, and 7 of the calibration paper.
- New Settings view adds `capture_debug_mode`, on by default. New screenshots run
  through a rollback-only preview with a draggable/resizable crop over the
  annotated page. Confirmed proposed/final regions and layout evidence are logged;
  the reviewed region drives the final immutable screenshot.
- Added explicit per-paper resource notes in task rows and “Approve note & save to
  Zotero” actions in tasks/resources. Export is blocked until the paper is read and
  its saved final note is non-empty. Source metadata comes from arXiv or the
  canonical page, while Tracker supplies only its note, tags, and local PDF.
- Zotero uses its authorized local API, retains keys only in process memory,
  persists object IDs/hashes for repeat-safe updates, preserves Zotero-edited
  bibliography/tags, and records partial file-sync failures for retry. Settings
  reports connection state and setup guidance.
- Validation: all 243 backend tests and 209 frontend tests, full backend
  Ruff/mypy, frontend lint, and production build. The existing Vite large-chunk
  and PyMuPDF binding deprecation advisories remain.
- Details and known limits: [PDF collection](pdf-annotation-collection.md) and
  [Zotero integration](zotero-integration.md).
# 2026-09-21 — Reliable study priorities

- Q&A now saves Core / High / Medium / Low as an explicit study priority; Auto restores tutor detection. Medium can override Core, and legacy capture priorities are preserved. Migration 0028 adds one nullable, validated column; revision checks and logical-question synchronization apply.
- Tutor labels such as “Priority: VERY CORE” take precedence over incidental details. Mixed labels use their first level; code, math and quotes are excluded. Answers without guidance show Untagged. Detection remains a conservative heuristic, with manual correction always available.
- Validation: targeted priority detection and persistence tests, including sibling captures and stale-revision rejection; frontend typecheck/lint.
# 2026-09-21 — Discussions as a study collection

- Added a default study overview across **all messages**, with purple pinned notes, priority-sorted source groups, compact expandable answers, resource review tiles and preserved book chapter tiles. Q&A order and underlying Markdown remain unchanged; editing remains in Response history. Occasional actions moved under More and capture tools collapse.
- Added source/priority/pinned filters and consistent cues in course-wide search. Plain-text previews avoid broken truncated formulas; full content remains rendered in Q&A/history. Unified exact section-pin recognition. Fixed scoped Q&A admitting unrelated follow-ups from other questions.
- API defaults now use same-origin `/api` so separately served previews cannot silently target the live database; explicit overrides and Vite's development proxy remain supported.
- Validation: full frontend suite, lint, TypeScript/build; backend workspace mutation suite; isolated-database browser checks for persistent priority/pins, resource/chapter scopes and responsive layout. See [design/audit notes](discussions-design.md) for behavior and known limits (heuristic priorities, snapshot notes, image-only titles, performance follow-ups).
