# Course progress export

Open **Debug → Course progress** or **Roadmap → Manage tasks → Course progress**.
The selected course gets a timestamped report with **Copy report**, **Download
Markdown**, and **Refresh report**. Both export actions use the displayed
snapshot. If clipboard access fails, the text is selected for manual copying.

The report contains:

- Course totals and each material's saved reading status/progress, plus saved
  book chapter statuses. Chapters without a saved status are not inferred.
- Open, answered, later, skipped and archived logical question counts per
  material and for the course. Tracked to-dos and established question identities
  remain counted; multiple captures of one question count once. Superseded crops
  are omitted when their replacement is present. Resolved sibling captures take
  precedence over open ones. Question text and answers are excluded.
- Study days ordered by planned date, with day status, opening/closure/completion
  dates, tasks, optional flags, status, estimates, recorded duration and saved
  task start/completion timestamps. Cancelled tasks remain visible; removed tasks
  do not. Unscheduled days appear last.
- Total time, session counts, running timers and recorded activity by calendar
  date. Session start dates use the browser's time zone; sessions crossing
  midnight stay on their start date. A missing day link can be inferred from an
  active task. Time without an active task/day remains in the day/course totals
  and is explicitly identified instead of disappearing.

This is a current-state outline, not a full status-change history. Timing uses
saved tracker records without triggering an external sync. Duration overrides
are respected, negative durations are clamped to zero, and running timers are
measured at the export timestamp. Zero recorded time does not imply no work.

`GET /api/courses/{id}/progress-export?time_zone=Europe/Copenhagen` returns only
`filename`, `markdown`, and `exported_at`. The service selects progress fields
directly; it does not load note documents, question bodies, discussion messages,
resource file paths or integration credentials. Note/discussion resources are
excluded from the material table. Counts for questions outside listed materials
appear as a separate subtotal. The export performs no study-data writes.
