# Study Tracker UI workflows

This guide describes the fastest intended study loop. The tracker is designed
to keep the current task, source context, questions, tutor response, and useful
notes in one place while making completed work visibly disappear into a compact
record.

## Global navigation

- `Option+1` through `Option+6` switch Roadmap, Resources, Skills, Exams, Notes,
  and Discussions without moving your hands to the mouse.
- `J` / `K` move to the next / previous Roadmap day when no editor is focused.
- Use the compact icon grid in the sticky header from every view:
  Back, Today, first open day, current timed task, copy day prompt, copy day
  questions, Resources, Notes, Discussions, day close/reopen, and Toggl.
- The crosshair icon becomes coloured while a task timer is running. Click it
  from any view to return to that exact task; a closed/complete day expands
  automatically and the task receives a `NOW` marker.
- Collapse the left sidebar when zooming notes or discussions. Its view icons
  remain available at the narrow width.

## Roadmap: complete one task loop

1. Click the time badge (`45m`, for example) on a task. It starts Toggl with the
   compact task action name. While running it shows tracked/planned time.
2. Open the source or its linked discussion from the resource chip.
3. Use the question icon beside a resource for a two-line inline capture. Choose
   Note, Question, Highlight, or To do; `Cmd+Enter` saves and Escape cancels.
4. Use the clipboard-picture icon beside a resource to import the last five
   images from Maccy. Each picture becomes an open question attached to this
   resource and study day, appears in ordinary question lists and QA, and is
   included as a `Q-###` image in the next tutor prompt. The adjacent image icon
   provides the same flow with files selected manually (useful for an older
   Maccy item or when macOS has not granted access to Maccy's private history).
5. Mark the task complete. The pet orbits the completion halo, the task receives
   a brief colour sweep, and—if it has no open questions—it contracts to one
   line. **Details** restores its resources and note editor.
6. On a book exercise task, press **Screenshot solutions** after writing the
   answers in Drawboard. The tracker finds each named `Exercise X.Y`, follows
   the connected handwriting below it, and refreshes the existing
   `data/chatgpt_prompt_attachments` folder with full-width solution crops.
   Missing handwriting is reported as a warning instead of exporting an
   unrelated annotation from a later exercise.

Question counts are de-duplicated per day. Book tasks with section numbers count
only annotations from those chapters.

### Fast markers

- Write `??` in an inline capture, slide draft, or saved task/resource note to
  promote it to a question. It becomes pink and counts as open work.
- Write `todo!` to promote it to a green todo. Resolving/archiving the generated
  capture removes it from the open count.
- The marker paragraph itself is highlighted when a note is saved. Markers
  inside fenced code blocks are ignored.

## Book progress

Book resources show small chapter squares:

- grey: not planned and unread;
- outlined: planned and unread;
- half green: read partially;
- solid green: read fully.

Click a square to cycle unread → partial → full → unread. Hover for the chapter
number, name, and plan state. Roadmap tasks show only their scoped chapter
squares; Resources shows the full configurable book map.

## Lecture reader

- Left/Right or Page Up/Page Down: previous/next slide.
- Home/End: first/last slide.
- Start typing: open a note for the current slide.
- Start with `?`: question. Start with `!`: todo.
- `Cmd+Enter`: save. Escape: cancel and return focus to slide navigation.
- Add `/screen` to include the current full slide PNG in the next ChatGPT prompt
  bundle. The command is removed from saved text. Questions always retain the
  slide image inside the tracker for personal context; `/screen` controls only
  whether it is sent to the tutor.

## Discussions: paste, review, follow up

1. **Paste response** imports the clipboard through the ChatGPT-aware Markdown
   converter. Short pasted fragments, small formulas, `text` code fragments,
   and short quote blocks are compacted; manual line breaks made later are not.
2. Press **QA** for the focused answer-review workspace. The original source
   page or slide stays on the left and the mapped answer is immediately editable
   on the right. When one answer covers several captures, every mapped source
   selection is shown in the left rail. The status beside the answer is **New**
   until visited, **Viewed** after review, **Updated** when a later answer or
   follow-up needs another pass, and **Understood** when all linked questions are
   complete. **Open only** works through the remaining questions; switch it off
   to revisit answered questions and introduction sections. Use
   `Cmd+Option+Left/Right` or the footer arrows to move, mark an answer
   **Understood** when it is clear, then commit every edited answer and queued
   follow-up together with **Save session** (`Cmd+S` also saves the session).
   Companion text and screenshot captures count as one answer group. For PDF
   questions the source rail shows the previous, current, and next page; the
   current page includes the real Drawboard highlights and handwriting and an
   outline around the question location.
3. For ordinary in-place work, switch the tutor message to **Edit**. Saving one
   answer section keeps the message in edit mode so adjacent questions remain
   available without reopening it.
4. Select a sentence, paragraph, formula, or code block. A floating card appears;
   type the follow-up and press `Cmd+Enter` to queue it. The message edit and all
   queued follow-ups are committed together only when you press **Save**.
5. `Cmd+H` / `Cmd+Shift+H` highlight ordinary text. The same shortcuts on a
   formula or code block create an anchored structured highlight: no colour is
   painted over the formula/code, but it appears in Highlights mode.
6. **Copy follow-ups** produces each selected excerpt plus its question under a
   stable descendant heading such as `Q-002-F1` (the next one on the same root is
   `Q-002-F2`). **Copy next** keeps original questions in the root namespace,
   such as `Q-021`. The two actions can therefore be combined in one tutor
   request without aliases. Paste the tutor's response normally; matching exact
   headings map each response back to its UUID and keep follow-ups beneath the
   original QA item. Opening QA shows the original question, every tutor-answer
   version, each compact purple follow-up message, and the corresponding
   follow-up answers as one chronological thread. Each answer remains an
   editable notebook and can be deleted independently. A new answer or follow-up
   changes the thread to **Updated** until it is reviewed again.
7. **Highlights** shows each valuable excerpt with surrounding paragraph context,
   rather than isolated fragments.

Linked questions remain expandable in both reading and editing mode, including
their PDF/slide images, extended context, and personal notes. Mark answers
Reference, Partial, or Done beside the mapped response section.

`Q-001` is a readable transport label, not the database identity. Every
annotation has an immutable UUID; all joins and statuses use that UUID. A new
prompt discussion may start again at `Q-001`, because its readable namespace is
local to that discussion. Within one discussion, an original annotation owns
one `Q-###` permanently: copying the same unanswered question again reuses its
label, while a newly copied question receives the next unused root number.
Copying next questions from another task continues that same discussion-local
sequence.

A follow-up is another annotation UUID whose `rootQuestionIds` points to the
original UUID. It is named under that root (`Q-002-F1`, `Q-002-F2`, …), so it can
never claim an original question's `Q-###`. A second tutor response under the
same exact heading is an answer version, not a new question; QA shows both on the
same page and permits deleting either version. If a pasted heading is absent
from the active discussion's stored label map, it stays visibly unmapped instead
of being guessed or silently attached to a similar question.

## Exercise QA

Book exercise tasks show two compact QA counters: required exercises understood
and all exercises in that chapter understood. Open **Exercise QA** to review the
chapter as one session. The left side renders the annotated Drawboard page with
your handwritten solution; the right side shows every tutor response mapped to
that exercise. Use **Later**, **Understood**, or **Skip**, then move with the
arrow keys or the footer controls. The status is stored in the task note, so it
survives plan syncs and immediately recolours both the exercise response cards
and progress badge on the Roadmap.

### Export tutor coding instructions

Wrap implementation guidance in a snake-case tag:

```markdown
<day4_code_task>
## Implementation order

1. Implement the backup.
2. Run the seeded comparison.
</day4_code_task>
```

Save the discussion. The content is synchronized to the configured
`day4_code_task.md` in the course discussion-export folder. Re-saving updates
the same tracker-owned section; another matching tag appends a separate section;
manual file content is preserved. The tagged block is collapsed in discussion
reading mode because the coding workspace is its primary destination.

## Notes and professor workflow

- `Cmd+B`, `Cmd+I`, ``Cmd+` ``, `Cmd+H`, and `Cmd+Shift+H` work in the Markdown
  note/discussion editor. `Cmd+S` saves discussion-message edits.
- The graduation-cap icon marks a note/discussion for the professor filter.
- The tiny highlighter icon appears only when highlights exist; it switches the
  note to a contextual highlights-only view.
- Write `@day2_simulate_bandits.py` or `@discussions/day4_code_task.md` in a
  course note to get a clickable local-file chip.

## Progress and rewards

- The sidebar activity map uses tracked hours as its main colour intensity:
  under 45 minutes, 45 minutes+, 2 hours+, and 4 hours+. Meaningful completion
  can also raise intensity when time was not recorded.
- Empty outlined cells show days that should already be complete; the glowing
  outline is the current catch-up target. The header shows the remaining catch-up
  count without deadline language.
- Completion animation is brief and local to the completed object. Motion follows
  the `pet_animations.json` presets and respects reduced-motion preferences.
- Use `/?petLab=1` to compare pet/motion combinations and copy a preferred preset.

The reward design intentionally emphasizes visible competence and small wins
while keeping control with you: no leaderboard, no punishment, and no artificial
points detached from study progress.

## Prompt attachment folder

Structured copy actions clean the contents of
`data/chatgpt_prompt_attachments` but keep the directory itself. Finder tags and
other folder metadata therefore survive. Upload only the files relevant to the
current tutor request; question/slide screenshots use the matching `Q-###` name.

When a prompt contains more than 20 question items, its confirmation reports
both counts: question items in the prompt and real files that will be placed in
the attachment folder (source/chapter PDFs plus question images). Keeping every
question is therefore reasonable when the file count still fits the service you
are using; choosing the short version still keeps only the first 20 questions.

### Maccy image access

The tracker reads Maccy's local SwiftData history without changing or deleting
it. On macOS, grant **Full Disk Access** to the application that launches the
tracker service (normally Terminal, iTerm, or the service runner), then restart
that application and the tracker. If Maccy uses a nonstandard database path,
set `TRACKER_MACCY_DATABASE_PATH` in `backend/.env`. The manual image chooser is
always available and does not require access to Maccy's history. Re-importing
the same pixels for the same resource is safe: the tracker reuses the existing
question instead of creating a duplicate.
