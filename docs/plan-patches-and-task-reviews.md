# Daily patches and task tutor reviews

## A task-to-tutor round

1. Write and **Save** your task note.
2. **Copy** on the task copies its title, task info, full saved note, and linked
   questions (including answered questions). Resource questions use the task's
   chapter scope; directly attached note questions and review follow-ups are
   included even when the task has no resources. Stable question IDs are retained.
3. Send that copied material to your tutor yourself.
4. **Insert review** accepts the complete response. Preview it, then check the
   headings to append to the task note. Unchecked headings must map to known
   Q-labelled questions. Unknown labels are retained in the review by default;
   the importer never guesses a different question or discards an unchecked section.
5. Import opens **Q&A**. The left pane shows a snapshot of the task, its info,
   and your work when the review was inserted. The right pane is the editable
   tutor review. Narrow windows stack the panes. Highlight, Ask follow-ups,
   Save session, and Mark understood work as in other discussions.

Copy, Insert review, and Q&A remain available on compact completed tasks.
Copy and Insert are disabled while that task note has unsaved changes. The
task's Q&A button reopens its reviews and mapped question answers.

Reviews append to the ordinary task note, with visible boundaries in rich mode.
The Markdown representation is:

```md
<!-- tutor-review:MESSAGE-UUID -->

## Task review
The tutor's Markdown, including formulas.

<!-- /tutor-review:MESSAGE-UUID -->
```

Insert review creates the IDs. Keep the boundaries when editing a review.
Note edits and Q&A edits synchronize in the same database transaction, with
document history. Removing a whole review block, deleting its answer, or
deleting its discussion removes its other representation too. Deleting the
task note deletes its linked review messages. Original work snapshots stay
fixed; later changes to your explanation belong in the normal task editor.
Markers inside fenced code are literal. Malformed, nested, duplicate, foreign,
or deleted review IDs reject the save rather than attaching to another answer.
Ordinary `??`/`todo!` note captures scan your work outside the appended review
blocks. Use **Ask** in Q&A for review follow-ups; this avoids duplicate captures.

A review import, appended note, snapshot, question-answer mappings, and new
discussion (if needed) commit together. Stale note revisions reject the import.
Retries of the same review import ID do not append twice. Task review imports
do not write tagged discussion exports to the filesystem. The existing
question-only import path remains available when no review section is selected.

## Task notes in a plan or patch

Declare the task with its stable ID, then add a note block anywhere outside code
fences in the same file. Headings and checklists inside the block remain note
content and cannot create extra days or tasks.

````md
+++
format = "study-plan/v1"
id = "trustworthy_offline_rl_research_sprint_2026"
mode = "patch"
+++

### Day 11: Policy gradients, baselines, and actor-critic {#d11-pg}
#### Reading and derivation
- [ ] Closed-book bridge. {#d11-pg-bridge}

::: task-note {#d11-pg-bridge}
## Explanation

Explain why a state-only baseline leaves the expected gradient unchanged:

$$
b(s)\nabla_\theta\sum_a\pi_\theta(a\mid s)=0.
$$

## My attempt

Write your reasoning here.
:::
````

Both full plans and patches support this syntax. One note block per task; its
task must be declared in that file. An empty block explicitly requests an empty
note. Omitting a block preserves the saved note.

After the first import, an unchanged source note preserves later editor work.
A changed source updates a note only if the editor still matches the previously
imported source. If both changed, the entire patch fails with a merge diagnostic.
To resolve it, copy the current note into the source, or save your merged text
in the editor and use that same text in the source. Existing user notes are
never silently replaced or supplemented with a hidden second task note.

## Apply a daily patch safely

```sh
make plan-validate PLAN=/absolute/path/to/patch.md
make plan-preview PLAN=/absolute/path/to/patch.md
make plan-patch PATCH=/absolute/path/to/patch.md
```

Preview executes the actual synchronization and rolls back every database
change. It detects live ID, order, note-conflict, and foreign-key problems that
syntax validation alone cannot find. Apply validates again against current data.
Every real CLI sync/patch creates a consistent, uniquely named SQLite backup in
`data/backups/` before changing rows; the successful result includes its path.
It never overwrites an existing backup.

Daily patches keep omitted tasks, sections, notes, task metadata, and dates.
New tasks append unless an order is given. Explicit swaps work; collisions with
unmentioned tasks/sections reject the whole patch. Partial skill declarations
merge into the day's existing skills. Explicit day IDs must identify that day;
a typo cannot silently alias another existing day by number.

Replaying the same status declaration preserves subsequent user progress.
Checkbox cancellation cannot silently undo a completed task. A changed explicit
`status=...` declaration can intentionally change its status. Completed/deferred/
skipped timestamps are reconciled when an explicit status change applies.

Skipped tasks do not count toward planned minutes. A task resumed or completed
inside a Cancelled section appears in expanded **Restored work**; its real UUID,
notes, history, and optional flag are preserved. Optional time is shown separately.

The apply transaction locks before checking mutable state, validates constraints
and foreign keys, then commits all database changes together. Errors roll back
documents, note revisions, progress, source bindings, and import receipts too.
Migrations are a separate step for existing databases; patch/preview never run
them automatically. The first full import may initialize a new empty database.

These guarantees concern database consistency. A valid patch can still express
an unintended plan, and backups do not make storage failure impossible. Review
the source/preview; a full-plan sync can intentionally retire omitted structure.

The convenience runner works from any directory:

```sh
scripts/apply-patch.sh --preview TORL_day11_cleanup_patch.md
scripts/apply-patch.sh TORL_day11_cleanup_patch.md
```

An optional second filename imports a file from Downloads after validation and
preview. The original download is retained; a different existing destination is
never silently overwritten. `scripts/update_day.sh` is an alias requiring the
patch name, with no hardcoded old-day default.

## Known gaps / follow-ups

- Old tutor feedback pasted manually into a note has no review boundary. It
  remains ordinary note content; it is not retroactively reclassified.
- The original-work snapshot is taken at insertion, not at Copy. Save any intended
  task-note changes before import. Snapshot editing is intentionally unavailable.
- Question-only imports use the existing answer-import endpoint; the new retry
  token applies to task review imports.
- Review boundaries require the tracker editor or Markdown source to preserve
  them. Other rich-text applications may drop HTML comments when copying notes.
- Large editor/application bundles still trigger the existing build-size advisory.
- Legacy FTS external-content tables have a preexisting direct-query inconsistency;
  rollback tests snapshot physical tables instead. Track a separate FTS repair.
