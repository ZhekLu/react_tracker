# Insert review and editor repair audit

Delivered September 16, 2026.

## Debug tab

Select **Debug** in the sidebar (Option–7). It shows the selected course's inserts
for a local calendar day. **All retained days** includes older pending reviews.
Paste/import boundaries and note, annotation, discussion, and task-review saves
record the original input plus imported, serialized, and reopened Markdown.
A save record describes the submitted content and HTTP outcome; the checker
reopens the serialized editor document, rather than refetching the database.

The automatic checks compare visible text, formulas, formatting marks, and block
structure before and after serialization, and validate formula rendering with
KaTeX. Checks run in a worker with an eight-second limit. They detect round-trip
regressions, but cannot infer the author's intended formatting. Use the preview
and Markdown source to review the original import too.

Choose **Parsed incorrectly** or **Could use improvement**, describe the passage,
and save the flag. Select a short passage in Original input, then edit/anonymize
its minimal input and expected Markdown. **Keep fixture & delete full record**
atomically retains that test case and removes the full record. Flagged reviews
require a fixture to complete; **Discard record** removes one without retaining a
fixture. Correct inserts can be completed directly.

Records expire after seven days, including flagged records. Storage is capped at
500 records and 20 MB of payload across courses. Cleanup runs on access, startup,
and hourly while the API is running. The separate `data/tracker_v2.editor-debug.sqlite`
is excluded from normal study backups, uses SQLite secure deletion, and has no WAL.
Fixtures retain only the explicitly chosen snippets (at most 3,000 characters per
input/expected field). Existing study notes and their revision history keep their
normal retention. Logging failure does not cancel the note save; Debug shows it.

Export fixtures from Debug, review their expected values, then run them against
the real editor from `frontend/`:

```sh
TRACKER_EDITOR_FIXTURES=/absolute/path/editor-regressions.json npm test -- src/lib/editorIntegrity.test.ts
```

Useful, anonymized cases can be added to `frontend/src/lib/editor-regressions.json`.
The test checks both parser output and save/reopen stability. No full audit exports
or tutor responses were added to this regression file.

## Root causes fixed

- Tiptap's serializer split formatting at inline formulas and closed overlapping
  marks in schema order. A single inline serializer now writes properly nested
  formatting spans containing both text and formula atoms. Block rendering still
  uses Tiptap. Code, links, underline, strike, table pipes, and line breaks are covered.
- Ordered and loose list parsing sometimes treated nested inline Markdown as
  literal text. Subsequent saves added escapes. List items now parse inline tokens
  consistently, including a single numbered item before a display formula.
- Default paste passed custom highlight syntax through a formatter unaware of it.
  Import now preserves canonical source; compact layout remains an explicit action.
- Read-only loading and composer previews used a different renderer/normalizer.
  The shared editor now owns discussion previews and saved rendering.
- Complete math-token hints, empty paragraphs/table cells, nested highlight
  colors, and multiline headings now survive serialization consistently.

## Live audit and repairs

All **670 currently editable documents** were checked with the actual editor.
An earlier wider scan also covered nine annotations under deleted resources;
those were excluded from repair. Deleted/orphan documents, prompt snapshots, and
revision history were not rewritten.

**24 documents were repaired in place**: six notes and eighteen discussion messages.
Repairs cover old HTML notes, escaped bold/formulas in list paragraphs, split
bold/highlight delimiters, the old split “Yes” defect, legacy display fences,
invalid matrix row separators/escaping, and one manually reviewed message with
two fragmented expectation formulas. Existing prose, question links, highlights,
and mirrored task-review content were retained. All current documents passed
text/math/mark/structure round-trip checks and formula rendering after repairs.
This verifies supported editor behavior; it cannot prove recovery of content that
was already missing from every historical revision.

The repair was rehearsed on a database copy, then applied under one write lock
with exact source hashes and document revisions checked for the entire batch.
A stale document rejects the batch. Each changed document and owning entity gets
a new revision, with `editor_audit_repair` recorded in document history. A SQLite
backup precedes application. The metadata-only report (including the backup path
and repaired IDs) is `data/editor-audit-2026-09-16.json`.

Maintenance tools, run from their respective directories:

```sh
# backend: snapshot current editable documents into a temporary private file
.venv/bin/python -m tracker_api.editor_audit snapshot /private/tmp/editor-input.json
# frontend: read-only scan and proposed repairs
node_modules/.bin/vite-node scripts/audit-notes.ts /private/tmp/editor-input.json /private/tmp/editor-plan.json
# backend: only after reviewing the proposed diff and resolving every check
.venv/bin/python -m tracker_api.editor_audit apply /private/tmp/editor-plan.json
```

Snapshot/plan files contain full study text: remove them after review. Maintenance
heuristics are never run automatically on editor saves. Unsupported Markdown
extensions (arbitrary HTML, footnotes, custom embeds) still need source editing.

## Validation

- 161 frontend tests, including 64 overlapping-selection combinations, repeated
  save/reopen, controlled editor state, import preservation, and minimal fixtures.
- 55 focused backend tests cover review flags, expiration/caps, fixture extraction with secure
  deletion, API contracts, repair rollback/history, mirrored task reviews, and backups.
- Browser checks on an isolated database: captured paste/save, saved bold/math/
  highlights after reload, review flags/feedback, current parser checks, fixture form.
- Frontend lint, TypeScript, and production build; targeted backend Ruff and mypy.
  Whole-backend mypy still reports the existing PDF/ink/exercise-service errors.
- SQLite backup now initializes WAL bookkeeping for a checkpointed source without
  sidecars and closes both connections; a regression test covers this case.
