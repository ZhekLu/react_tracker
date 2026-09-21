# Discussions: a study collection

## What changed

The default view is a study overview of the **entire discussion**, across every
tutor message. It uses the same question-thread model as Q&A: one original
question, its captures, answers and follow-ups stay together. Related answers in
other discussions remain accessible through that question's existing history.

- Important questions have a purple card and a pinned shelf above all ordinary
  answer groups. Pin/unpin from the overview or Q&A; the existing Important
  answers collection in Notes is preserved.
- Other threads group by their original resource, including follow-ups captured
  inside a discussion. Shared questions use an Across sources group. Free-form
  responses remain in Discussion notes instead of acquiring guessed links.
- Within each source, Core comes before High, Medium, Low and Untagged. Groups
  appear in the order of their highest-priority visible thread. Ties keep the
  existing Q&A order. **Neither Markdown nor Q&A navigation is reordered.**
- Day discussions have resource tiles opening scoped Q&A; book chapter tiles
  retain their chapter-specific entry points. Progress counts understood question
  threads, including their follow-ups, rather than message count.
- Cards show a short preview; click the title to read the latest answer, Open Q&A
  for the complete question/answer chain, or Full response to edit in context.
  Response history preserves whole-message and section editing/deletion.
- Search by source, priority, pinned status or text. The course-wide finder also
  surfaces pins and priority labels. No full answers are removed by pagination;
  Show more reveals the next batch and filters search the complete collection.
- Review and Paste response are primary actions. Copy, highlights, archive and
  other occasional actions live under More. Capture tools are collapsible.

## Priority rules

Q&A offers Auto, Core, High, Medium and Low. Explicit choices persist in
`annotations.discussion_priority` and synchronize across captures of the same
logical question, with revision checks. Migration 0028 adds a nullable column;
existing capture queue priority and content are unchanged. NULL retains legacy
priority behavior; Auto explicitly opts back into tutor inference.

Auto recognizes explicit labels such as `Priority: VERY CORE`, `Priority: High`
and `Importance: medium`. The first explicit label wins: `CORE intuition, LOW
implementation detail` is Core; `medium / low` is Medium. Code, formulas, quoted
text and HTML are excluded. A few conservative prose phrases are recognized;
otherwise the answer is Untagged. The original tutor wording remains visible.

## Audit findings addressed

1. Sorting within individual messages concealed important answers in older
   replies. A single derived overview now spans every message.
2. Normal/Medium could not override inferred Core; Core and Auto were missing
   from manual controls. Study priority now has its own explicit field.
3. Full repeated source headings and large expanded messages made scanning hard.
   Source groups, compact cards and separate response history reduce repetition.
4. Section-only pins were not consistently recognized. Q&A and overview now use
   the same exact saved-section marker lookup plus annotation links.
5. Scoped Q&A could add unrelated follow-ups and all questions from their parent
   message. Explicit question/resource/chapter scopes now constrain those joins.
6. Finder snippets collapsed multiline Markdown and math into malformed markup.
   Previews are bounded plain text, with `[formula]` placeholders; expanded
   answers and Q&A render the original Markdown and formulas.
7. A hardcoded API URL sent separately served previews toward the live server.
   Defaults now use same-origin `/api`; Vite retains its local development proxy
   and `VITE_TRACKER_API_BASE` still overrides the endpoint explicitly.

## Limits / follow-ups

- Priority inference is a heuristic, not an interpretation of arbitrary prose.
  Use the explicit control when the tutor's wording is ambiguous. Within a
  thread, Auto uses the first explicit label in its chronological answer history.
- A card previews the latest answer; all earlier answers remain in Q&A/history.
  Some image-only questions have no meaningful textual title, so page and stable
  question ID are used instead of inventing a summary.
- Existing Important answer notes are saved snapshots, not live mirrors of later
  edits. Pin state identifies the question thread; Q&A displays current answers.
- Large-course parsing/render performance and existing large bundle warnings
  remain candidates for profiling. No new editor or database framework is needed.

## Verification

Regression tests cover sorting across separate messages, unchanged Q&A order,
source inheritance, exact pins, resource scopes, previews and UI interactions.
Backend tests cover persisted levels, Auto, shared captures and stale revisions.
Browser checks on an isolated database cover Medium overriding Core, Auto restoring
Core, pin persistence after reload, single-question/resource/chapter Q&A scopes,
and desktop/narrow layouts without horizontal page overflow.
