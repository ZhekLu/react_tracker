# Discussion and note editor audit — September 2026

## Decision

Keep Tiptap/ProseMirror, and use one shared editor for discussions, Q&A, entity
notes, and day notes. Keep Markdown as the persisted format because discussion
exports, tutor prompts, revision history, and existing documents use it.

The reproduced failures were caused by lossy transformations between Markdown
and the editor, several behaviors in the installed Tiptap Markdown extensions,
and save-state handling. Replacing the editor without fixing these boundaries
would retain much of the problem and add a document migration.

The new boundary is explicit:

1. External paste can repair the known degraded tutor-copy formats. Existing
   formulas, code, and links are protected first. Layout compaction is opt-in.
2. While editing, ProseMirror owns the document and undo history. A React
   `onChange` echo must not replace or reparse it.
3. Save serializes once. Ordinary saves do not guess missing spaces, repair
   literal bracket text, or compact paragraphs. A no-op editor save retains its
   original input. Explicit LaTeX delimiters can still be converted to Markdown
   math delimiters at the discussion boundary.
4. Markdown source mode provides direct access to the underlying document.
5. Tiptap dependencies are pinned to the tested 3.27.0 version. Future upgrades
   must pass the real-editor regression tests, not only string-normalizer tests.

## Confirmed defects and changes

| Area | Cause and effect | Resolution |
| --- | --- | --- |
| Formula spacing and highlighting | Highlight parsing trimmed meaningful spaces; upstream mark helpers skipped inline math atoms. Controlled updates also replaced the document, disturbing selection and undo. | Preserve span whitespace and math marks on both parse and serialize. Ignore controlled echoes and non-document transactions. Toolbar and keyboard highlights share a command path. |
| Long tutor note | The alphabetic-list tokenizer could split `Yes.` into `Y` and a list beginning `es`. List serialization used insufficient continuation indentation for numbered lists, losing nested display formulas after reopening. | Use standard numbered-list tokenization and indent continuation blocks by the actual list marker width. |
| Valid LaTeX | Repeated repair passes changed valid operators and row separators and removed display indentation. | Preserve explicit `$`/`$$` bodies; isolate legacy repair from ordinary saves. Preserve indentation for multiline `\[...\]` displays. |
| Paste layout | Automatic compaction merged paragraphs, removed repeated text, flattened some quotes/code, and converted small display formulas to inline formulas. | Preserve structure by default; expose **Compact layout** as an explicit composer action. Protect URLs and code before legacy repair. |
| Answer boundaries | Heading-like text in code/math could become fake answer sections; the exercise import path had the same issue. | Mask literal nodes using the Markdown syntax tree while preserving source offsets, then resolve section headings. Unfinished fences are covered. |
| Question mapping | Unlabeled tutor notes could be attached to unrelated open questions. A resource lookup could also choose the wrong discussion. | Automatic links require explicit question labels; exact discussion IDs take precedence. Generic tutor notes remain independent messages. |
| Unsupported common content | Tables, images, and deeper headings were missing from the editor schema. Typography also rewrote typed text. | Add table/image support and all six heading levels; remove automatic typography substitutions. |
| Divergent note editor | Day notes used a second HTML editor with different behavior. | Replace it with the shared Markdown editor, including the same asynchronous Save/⌘S path. Existing HTML notes remain readable. |
| Note markers | Wrapping a blank-line-delimited chunk for `??`/`todo!` could wrap headings, tables, or formulas. | Identify prose paragraphs through the syntax tree and edit only their exact spans. Ignore markers in code/math. |
| Save failures | Some parents discarded the save promise, closed editors, or cleared drafts before persistence succeeded. | Return and await save results; retain failed drafts and queued review items, show errors, and disable editing during saves. Q&A retains unsaved work after a partial session failure. |
| Discussion controls | Nested section accordions hid content; headings were outside editable bodies; section deletion was unavailable. | Readable sections with direct Edit/Delete controls; section and whole-message editors include headings. Switching sections retains their drafts. Deletion preserves remaining sections and only reopens exclusively linked questions. |
| Hidden editor cost | Closed message rows still mounted rich editors and rendered all their math. | Mount the message content only while expanded, retaining section draft state in the message component. |
| HTML fallback | A loading fallback inserted stored HTML directly into the DOM. | Show a loading placeholder until the schema-based editor is available. |

## Standalone review sources

An unlabeled tutor message now has **Review as source**. It creates one stable
review-root annotation anchored to that message and opens Q&A for the entire
note, including its introduction and all headings. Repeating the action reuses
the same root. Marking it as a source does not mark it understood or answered.

Review status, highlights, queued follow-ups, copied prompts, and later tutor
answers use the existing UUID-based Q&A relationships. Follow-ups retain the
source root and its stable label, including when created before a prompt batch
exists. The source message is not treated as an answer to its own follow-ups.
Deleting the source message soft-deletes its source annotation. This requires no
new database migration.

## Verification

The user's exact pasted Day 10 DQN note is retained in
`frontend/src/lib/day10TutorNote.raw.fixture.md`. Tests import it into an actual
Tiptap editor and reopen its serialized output. They verify the opening prose,
all **23 display formulas**, **five numbered steps**, the blockquote, and KaTeX
validity. Separate editor tests repeatedly save/reopen highlighted inline math
and verify spacing, marks, and undo. React tests exercise controlled updates,
no-op saves, rejected saves, and the keyboard save path.

Final checks:

- Frontend: **135 tests passed across 26 files**; TypeScript, ESLint, and production
  build passed.
- Backend: **42 focused tests passed**, covering workspace mutations, discussion
  exports, and the standalone-source lifecycle.
- Ruff passed for the changed API/repository and new backend test. Targeted mypy
  passed for the API routes and workspace repository with imported modules
  followed silently.
- Whole-backend mypy still reports 12 errors in existing PDF/ink/exercise-solution
  service code outside this editor change.
- Browser checks used an isolated temporary database: full-note review-source
  creation, heading edit/save, follow-up creation, section deletion, inline math
  highlighting/save/reopen, and section-draft switching. No study content was
  edited in the live database for these checks.

## Remaining limits

- This is a tested Markdown editing subset, not a byte-for-byte editor for every
  Markdown extension. Footnotes, arbitrary raw HTML, and custom embeds still need
  source editing; converting unsupported content through the visual schema can
  change it. Tables/images are supported, but their advanced editing controls
  are not yet exposed in the toolbar.
- Inline highlights are stored in Markdown. Display-math/code review highlights
  use the existing separate discussion review annotations; ordinary note text
  marks do not provide a general block-highlighting format.
- Drafts survive failed saves and section switching within the mounted view.
  They are not durable autosaves across a browser reload or leaving the view.
- Historical content already damaged by an earlier save cannot always be
  reconstructed. The follow-up [insert diagnostics and repair audit](editor-debug-and-repairs.md)
  checked 670 current documents and repaired 24 in place with backups and history.
- Vite still reports the large shared-editor chunk (about 719 kB minified,
  224 kB gzip). It is lazy-loaded. Further bundle reduction and virtualization of
  very long open discussions remain performance work, separate from the data
  integrity fixes.

## Follow-up: September 16

The [insert diagnostics and repair audit](editor-debug-and-repairs.md) supersedes
the historical-repair status and validation counts above, and adds the Debug tab.
