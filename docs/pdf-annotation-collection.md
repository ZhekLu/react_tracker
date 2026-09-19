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
- Question marks on one page belong to one screenshot group when their Y ranges
  share any coordinate, including overlap through another mark. Horizontal
  distance and mark type do not matter. A positive Y gap or another page keeps
  screenshot groups separate. Only question marks can bridge question groups.
- A group containing handwriting/visual marks produces one screenshot question.
  Highlight quotes are attached to its quote and `highlightedText` metadata. No
  additional question is created for those highlights.
- Paragraph context still groups questions and annotations in the review UI.
  It does not create another screenshot or overwrite source membership.
- A screenshot includes surrounding source content, which may include other
  colours. Those contextual marks are not separate imported notes/questions.
- Previously tracked questions stay tracked after recolouring. Recollection
  preserves IDs, answers, manually edited notes and closed-question screenshots.
  Missing source marks are retired without deleting historical study content.
- Source PDFs are read only. The preview API rolls back database writes.

## Regression coverage

The same synthetic annotated PDF is tested through both connectors for colour
selection, mixed highlight/ink groups, cross-column grouping, ignored regular ink,
paragraph context, separate pages, stable repeat collection and saved answers.
The historical chapter 11/page 282 frame fixture also remains covered.
