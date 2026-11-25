# Thesis literature and research planning course

The canonical plan and decision worksheet remain in `Tracker/study_plans/thesis/`,
outside this nested repository:

- `thesis_literature_and_research_plan_FINAL_2026-11-26_to_2026-12-11.md`
- `thesis_research_plan_decision_worksheet.md`

Course: **MSc Thesis - Literature and Research Plan** (`THESIS-LIT`), plan ID
`thesis_hierarchical_offline_ope_scope_sprint_2026`. The sprint covers 12 weekdays,
26 November–11 December 2026, with 47 work tasks and 12 completion gates, 14
resources, and five skills. The deadline is the sprint deadline.

From the React tracker repository root, validate and preview with:

```sh
make plan-validate PLAN=../study_plans/thesis/thesis_literature_and_research_plan_FINAL_2026-11-26_to_2026-12-11.md
make plan-preview PLAN=../study_plans/thesis/thesis_literature_and_research_plan_FINAL_2026-11-26_to_2026-12-11.md
```

Use `make plan-sync PLAN=...` for the first import and `make plan-update PLAN=...`
for later full revisions. Preserve existing plan, day, and task IDs. Imports
automatically back up the database.

Daily objectives use plain `Purpose:` labels, as required by the parser. The
decision worksheet is a Markdown resource linked to six planning tasks, rather
than a separate course. Daily artifacts are captured by the `Stop when:` tasks;
general sprint guidance and later conditional milestones remain in the source
plan. The thesis-pitch resource keeps its original DSB PDF; `course_files.json`
trusts that PDF's directory so the app can read it.
