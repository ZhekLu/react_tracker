# PDF annotation collection

Local/iCloud PDFs and the Drawboard Cloud book use the same service. Connectors
read source annotations and provide their IDs, geometry, colours and text. Native
PDF rendering and cloud vector rendering differ; collection rules do not.

## Rules

- Colour roles are shared per course. The same palette confirmation appears for
  new exact colours from either connector; red is suggested as a question colour.
  Explicit saved roles override suggestions. `??` and `todo!` text markers also
  request a question, preserving the existing book convention.
- Regular-colour handwriting and visual shapes stay in the PDF. Regular text
  highlights and text notes are collected normally.
- A question-colour highlight without handwriting/another visual annotation is
  also collected as text only. It never creates a screenshot by colour alone.
- Page text is inspected before grouping. A page is treated as two-column only
  when both text lanes have enough lines, a stable gutter, and few crossing
  lines. Uncertain and ordinary full-page layouts remain single-column.
- Layout detection only assigns question marks to `left`, `right`, or `full`.
  Gutter-sized handwriting fragments first inherit the nearest vertically
  connected lane; then the original transitive Y-overlap grouping is reused.
  A two-point tolerance absorbs pen-fragment rounding gaps, while a larger gap
  or another page keeps groups separate. This prevents vertically aligned notes
  in two distinct columns from merging without duplicating one handwritten note
  that crosses the gutter or was stored as several almost-touching PDF marks.
- A mark that substantially spans both detected columns stays in the `full`
  lane. The debug review can expand a proposed column crop for full-width tables
  or other source layouts that text geometry cannot identify reliably.
- A group containing handwriting/visual marks produces one screenshot question.
  Highlight quotes are attached to its quote and `highlightedText` metadata. No
  additional question is created for those highlights.
- Paragraph context still groups questions and annotations in the review UI.
  It does not create another screenshot or overwrite source membership.
- A screenshot includes surrounding source content, which may include other
  colours. Those contextual marks are not separate imported notes/questions.
- Screenshot crops use the detected logical lane. With capture debug mode on
  (the default in Settings), collection first runs as a rollback-only preview
  and asks for confirmation of each new screenshot. The crop can be moved or
  resized directly over the annotated page before the final render.
- Every confirmed crop records the proposed/final rectangle, page dimensions,
  and detected layout lane in `capture_region_corrections`. These records are
  diagnostic/training data only for now; corrections are not yet generalized
  automatically to other papers.
- Previously tracked questions stay tracked after recolouring. Recollection
  preserves IDs, answers, manually edited notes and closed-question screenshots.
  Missing source marks are retired without deleting historical study content.
- Source PDFs are read only. The preview API rolls back database writes.

## Regression coverage

The same synthetic annotated PDF is tested through both connectors for colour
selection, mixed highlight/ink groups, ignored regular ink, paragraph context,
separate pages, stable repeat collection and saved answers. Dedicated layout
tests cover confident two-column separation, conservative single-column fallback,
gutter-fragment/tiny-gap deduplication, text-only red highlights, review
persistence, and explicit crop rendering. The annotated
`function_approximation_error.pdf` was also inspected as the real two-column
calibration paper: all ten pages detect two columns and the formerly merged page
3/4 left/right notes form separate groups. Its page 2, 6, and 7 duplicate capture
pairs now each form one group. The historical chapter 11/page 282 frame fixture
also remains covered.
