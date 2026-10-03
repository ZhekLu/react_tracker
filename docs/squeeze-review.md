# Squeeze review

Open **Debug → Squeeze review**. On first opening for a course, the tab copies
the three newest distinct retained raw pastes of at least 300 characters. These
are labelled as raw pastes: generic paste logging cannot prove they are tutor
answers. Saves are excluded because their text has already been parsed/edited.
If raw logs have expired, use **Add a historical raw response**. Original input
is immutable; review edits affect only the example copy.

Click a fragment to focus keyboard review:

| Key | Action |
| --- | --- |
| ↑ / ↓ | Previous / next fragment |
| ← / → | Previous / next response, once current decisions are saved |
| W | Attach to the preceding paragraph with one space; convert a selected formula/text field to inline when necessary |
| S | Start a separate paragraph |
| A / D | Make a formula or text field inline / block |
| Enter | Accept the current suggestion and advance |
| Ctrl/Cmd-Z | Undo the last decision |

The buttons perform the same commands. **Edit fragment** accepts Markdown,
including formula/code delimiters. Shortcuts do not intercept typing in source
fields or the editor. List items, headings, programming code, tables and quotes
form boundaries; joining cannot move text across them. List-item fragments can
be reviewed individually. The live preview shows the current paragraph and
neighboring context with the normal discussion renderer. The full response and
original raw input are available below it.
The selected response and fragment are remembered in this browser.

Decisions save automatically in a serialized, revision-checked queue. A failed
write remains visible and blocks response switching; export the draft or retry.
Pending command/edit decisions also have a browser recovery copy, restored when
it is based on the current server revision. A conflict requires exporting the
draft and reloading; a stale recovery copy is not silently applied to newer
server content. Unapplied text in the fragment editor is a temporary draft.

**Export all decisions** downloads the corpus as JSON. **Export this draft**
also works when a server save fails. **Download Markdown** gives the reviewed
response. JSON includes the immutable raw input, canonical input, initial parser
output/version, every fragment's original/edited source, container, suggested
and chosen layout/boundary, explicit review flags, and command history with
before/after values and preceding text. Navigation alone does not label a
suggestion as accepted. Undo restores labels as well as layout. Only explicitly
reviewed boundaries/layouts should be treated as training targets.

Review examples live in `data/tracker_v2.squeeze-review.sqlite`, separately from
study documents, backups, usage telemetry and expiring editor diagnostics. These
user-selected examples have no automatic expiry. No corpus is committed to Git.
Export it to back it up. No model is trained yet; the labels can support either
rule refinement or a small classifier after enough examples have been reviewed.

## Initial automatic rules

New external pastes use source-preserving squeezing. Normal saves/reopens retain
authored boundaries. The **Squeeze layout** composer button reapplies the rules.

- Display formulas become inline when their normalized LaTeX source is at most
  56 characters, contains no fraction/binomial command (including `\frac12`),
  no multiline environment/row separator/tag/label, and is not a leading-equals
  continuation. Manual A/W can override this suggestion.
- A one-line `text` fence of at most 160 characters becomes inline code, except
  recognizable box/grid diagrams. Other code languages stay fenced.
- A single sentence/fragment of at most 220 source characters can attach to the
  preceding eligible paragraph, with a 700-character combined limit. Converted
  short formulas/text fields can attach too. Separate list items never merge.
- Highlights, links, repeated text, hard breaks within paragraphs and protected
  block structures remain intact. Code protection no longer adds blank lines on
  each successive import.

These thresholds are a starting heuristic. They do not infer topic changes, and
some short separate sentences will need S during review. Fragment navigation is
based on Markdown paragraphs/formulas/text fields, not visual wrapping at the
browser width. Quotes and tables are reviewed as whole protected blocks.
