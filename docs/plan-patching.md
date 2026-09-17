# Plan patching reference

Use this reference when writing a patch yourself or asking a tutor to generate one.
It describes the supported `study-plan/v1` format. The same document is available
in **Roadmap → Manage tasks → Patch guide**, with a Copy guide button.

## Start with the current tracker state

1. Open **Manage tasks**, choose the day, and **Copy day context**. This gives
   current task/day/section IDs, titles, status and resource links without notes
   or tutor responses. Pair it with **Copy guide** for your tutor.
2. Reuse an existing task's ID for every rename, move, status or resource change.
   A new ID creates a new task even if the title resembles an old one. This is the
   main way accidental duplicates arise. Names are not identity.
3. Use a new, descriptive ID only for genuinely new work. IDs must be unique
   throughout the plan. Existing source IDs and exported database UUIDs both work.
4. Generate a small `mode = "patch"` file. Omitted days/tasks/notes remain intact.
   Do not use `full` for a daily update: full synchronization can retire omitted
   structure across the course.
5. Validate, preview, inspect the changes, then apply. Keep the original patch file.

The copied context is reference data, **not an executable patch**. Do not paste
its JSON directly into the importer. Replace the example IDs below with real ones.

## Smallest patch

```md
+++
format = "study-plan/v1"
id = "the-existing-plan-id"
mode = "patch"
+++

### Day 11: Policy gradients {#existing-day-id}
#### Reading {#existing-section-id}
- [ ] Read Chapter 13 {#existing-task-id}
```

The outer `+++` lines delimit TOML metadata. Day headings are `### Day N: Title`;
sections are `#### Title`. Every patch day and task needs an explicit `{#id}`.
Prefer an explicit section ID too, especially when renaming a section. The plan
ID selects the existing course, not a new patch version. Keep it unchanged.

## Task scenarios

| Intent | Declaration or action | Result |
| --- | --- | --- |
| Rename | `- [ ] Better title {#same-task-id}` | Keeps the same task, notes and history. |
| Add | `- [ ] New task {#new-unique-id type=write minutes=25}` | Appends new work; uses `todo` initially. |
| Cancel | `- [-] No longer needed {#same-task-id}` | Sets skipped where status rules permit; remains visible as cancelled work. |
| Explicitly cancel completed work | `- [-] No longer needed {#same-task-id status=skipped}` | An intentional changed status declaration can cancel completed work. |
| Delete from tracker | `- [ ] Duplicate {#same-task-id delete=true}` | Removes it from study views; preserves learning content and can be restored in Manage tasks. |
| Defer | `- [>] Revisit later {#same-task-id status=later}` | Sets later. UI offers the same status. |
| Resume | `- [ ] Resume work {#same-task-id status=todo}` | Sets todo when the explicit source status changes. |
| Start | `- [/] Work underway {#same-task-id status=in_progress}` | Marks in progress. |
| Complete | `- [x] Finished work {#same-task-id status=done}` | Marks done. |
| Make optional/core | Add `optional=true` / `optional=false` | Changes whether the task is required. |
| Set time estimate | Add `minutes=30` | Nonnegative whole minutes; `0` is allowed. Use UI to clear the estimate. |
| Move | Declare the **same task ID** under the destination day and section | Preserves identity and study content. Declare a task only once per file. |
| Reorder | Add `order=N` to sections/tasks | Sets an explicit order; collisions reject the entire patch. |
| Attach/replace resources | Add `resources=book,lecture` with declarations below | Replaces the task's resource links with that list. |
| Detach all resources | Add `resources=""` | Clears links only; resources and annotations survive. |
| Leave resources alone | Omit `resources` and inline resource links | Existing links are preserved in patch mode. |
| Update instructions | Add `info="What to do"` or `why="Why this matters"` | Updates task rationale; Markdown also supports inline task annotations. |
| Add/update task note | Use `::: task-note {#same-task-id}` below | Uses conflict checks to preserve editor work. |

### Deletion rules

Deletion requires a real existing task **in the named day**. Use only its ID and
`delete=true`; do not combine deletion with resource/status/metadata edits or a
task-note block. The label is just for readability. A missing/incorrect ID fails
instead of creating a task. Full plans cannot contain deletion directives.

Deletion is distinct from cancellation: a cancelled task is still part of the
visible plan; a deleted task is absent from normal tracker views. Its identity,
notes, tutor reviews, questions, resources and time records remain recoverable.
No shared book, lecture or other task is deleted. **Manage tasks → Deleted →
Restore task** restores it; an occupied old order position causes an append.

A deletion patch is safe to replay. An ordinary patch naming a removed task fails
instead of reviving it. Restore it explicitly before editing it again. Stop a
running task timer before deleting/cancelling the task.

### Status replay and manual edits

The tracker remembers the last imported status declaration. Replaying the same
declaration preserves later user progress, even when a checkbox looks unchecked.
An explicit `status=...` is applied when that declaration changes. If an old
declaration was already applied and you now want to force a status, use Manage
tasks instead of assuming a repeated patch will reset it. Plain cancellation
checkboxes do not silently undo completed tasks.

Fields edited in Manage tasks are protected. A patch may use their current value
or omit optional fields; a conflicting replacement fails as one transaction.
**Allow patch edits** releases that protection when you intentionally want a tutor
patch to take over. It changes no task content itself. Full plans also cannot
silently remove protected tasks. Editing resources in the UI does not alter the
original plan file: copy fresh context when generating your next patch.

## Resources

Resource keys must be declared in TOML or provided by the plan's existing registry.
Use existing IDs/keys from current context; do not create a second book because
its display title changed. An existing resource's real UUID is also accepted as
its key, with course ownership checks.

```md
+++
format = "study-plan/v1"
id = "the-existing-plan-id"
mode = "patch"

[resources.book]
title = "Sutton and Barto"
kind = "book"
path = "/absolute/path/to/book.pdf"

[resources.lecture]
title = "Policy gradient lecture"
kind = "slides"
url = "https://example.org/lecture"
+++

### Day 11: Policy gradients {#existing-day-id}
#### Reading {#existing-section-id}
- [ ] Read Chapter 13 {#existing-task-id resources=book,lecture}
```

`path` is relative to the patch file unless absolute. Quote TOML strings normally;
do not use shell backslash escapes for spaces. `paths = ["...", "..."]` supports
multiple local files. Common resource fields: `title`, `kind`, `path`/`paths`,
`url`, `category`, `authors`, `year`. Markdown links inside a task also create
resource links, so avoid them when you mean to leave current attachments alone.

For book scope, name the chapter range in the task title (e.g. `Chapter 13` or
`Chapters 5–7`). An unspecified book task inherits explicit chapters from other
non-skipped tasks for that same book/day. Inheritance does not cross books.

## Notes and preserved work

````md
### Day 11: Policy gradients {#existing-day-id}
#### Derivation {#existing-section-id}
- [ ] Derive the baseline identity {#existing-task-id type=write minutes=20}

::: task-note {#existing-task-id}
## How to approach it

Explain why this expression is zero before doing the algebra:

$$
b(s)\nabla_\theta\sum_a\pi_\theta(a\mid s)=0.
$$

## My attempt

Write here.
:::
````

Declare the task in the same patch. One note block per task; Markdown headings,
checklists and fenced examples inside it remain note content. Omit the block to
keep the current note; an empty block explicitly requests empty content.

An unchanged source note preserves subsequent editor work. A changed source note
updates only when the editor still matches its previous imported source. If both
changed, the whole patch fails. Merge current work into the new source, or save
the merged text in the editor and supply exactly the same text in the patch.
Keep `<!-- tutor-review:... -->` boundaries intact; see the task-review reference
for synchronized tutor notes. Never regenerate IDs inside those boundaries.

## Days, sections, ordering and skills

- Keep the existing day ID and number. An unknown ID for an existing day number
  is rejected. A new day needs a new ID and unused number/order.
- Rename a day in its heading. Set a date as
  `### Day 11: 2026-09-17 - Policy gradients {#existing-day-id}`;
  omission preserves an existing date in patch mode.
- Rename a section using its existing section ID. Changing only the title of an
  implicitly identified section may create a new section.
- New tasks append unless `order` is explicit. Task positions use
  `section_order * 1000 + task_order`; changing section and task order can
  conflict with unmentioned rows. Preview detects collisions. Declare both
  sides of a swap in the same patch. Move a task by placing its existing ID in
  the destination section, rather than deleting and recreating it.
- Optional/Additional/Cancelled sections infer optionality unless overridden.
  Skipped tasks are excluded from planned time. Resumed work in a Cancelled
  section is shown as Restored work.
- Define `[skills.key]` with `name` (optional `category`, `description`) and use
  `skills=key,other` on days/tasks. Partial skill declarations merge in patch mode.
- Course fields such as `title`, `short_code`, `subtitle`, `accent`, `icon` and
  `deadline` belong in TOML before resource/skill tables. Omit unrelated fields.
- Partial patches do not delete entire days/sections/resources by omission.
  Use task deletion for cleanup. Whole-plan restructuring requires a carefully
  reviewed full sync. UI administration currently manages tasks, not whole days
  or resource files; attaching a resource uses the existing course library.

## Validate, preview and apply

```sh
make plan-validate PLAN=/absolute/path/to/patch.md
make plan-preview PLAN=/absolute/path/to/patch.md
make plan-patch PATCH=/absolute/path/to/patch.md
```

Or use the convenience wrapper from the tracker repository:

```sh
scripts/apply-patch.sh --preview my_patch.md
scripts/apply-patch.sh my_patch.md
```

The wrapper resolves named files in `../study_plans/special_course/patches/`.
An optional second filename copies that file from Downloads after validation and
preview. Originals remain intact; conflicting destination content is rejected.

Preview executes the real sync inside a rolled-back transaction. Apply rechecks
current state, holds a write lock, makes a consistent backup, and commits atomically.
Errors roll back task changes, notes, source bindings, audit receipts and progress.
CLI output reports the backup under `data/backups/`. Deletion patches require a
backup even when called directly from code. UI changes each take their own backup.

Administration history shows the latest 100 operations; the database retains all
receipts, including before/after task metadata and backup locations. It does not
copy note bodies or tutor responses into that log. Normal server logs record failed
requests too. Restore recovers removed tasks. For another mistaken edit, use its
before-values in history to make a new edit. A whole-database restore is a developer
recovery operation; stop the service and preserve the current database first.

## Before sending a tutor-generated patch

- Include the current context and this reference.
- Request `mode="patch"`, unchanged IDs for existing work, new IDs only for additions.
- Ask for only the intended days/tasks and explicit resource lists when changing links.
- Distinguish cancellation from deletion and preserve notes unless a merge is intended.
- Preview before apply. If an ID or protection conflict appears, correct the patch;
  do not guess a new ID or switch to `full` to make the error disappear.

Further details: [task notes and tutor reviews](plan-patches-and-task-reviews.md).
