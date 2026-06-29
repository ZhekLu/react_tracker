# React Tracker Backend

FastAPI + SQLite backend for the React tracker rewrite.

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/backend
uv sync
uv run python -m tracker_api.main
```

Endpoints:

- `GET /api/health`
- `GET /api/courses`
- `GET /api/courses/{course_id}/workspace`
- `PATCH /api/tasks/{task_id}/status`
- `PATCH /api/days/{day_id}/status`
- `PATCH /api/resources/{resource_id}/status`
- `PATCH /api/exam-questions/{question_id}/status`
- `PATCH /api/annotations/{annotation_id}`
- `POST /api/notes`
- `POST /api/resources/{resource_id}/open`
- `POST /api/discussions`
- `POST /api/discussions/{discussion_id}/messages`

The database is created at `react_tracker/data/tracker_v2.db`.

Resource opening reads `Tracker/toggl_config.json`. The requested path must be
inside one of `open_allowed_roots`. PDFs use `pdf_app` when configured; other
resources use the operating-system default application. This keeps machine
paths and application choices outside the frontend bundle.

Database workflow from `/Users/eugene/Documents/Thesis/Tracker`:

```sh
make react-backend-install
make react-migrate
make react-import-v2
make react-sync-plans
```

The importer expects a normalized v2 bundle. Raw tracker exports should first be
converted with `dump/convert_tracker_dump_to_v2.py`.

`react-import-v2` is an optional one-time legacy-state migration.
`react-sync-plans` is the repeatable workflow after Markdown plan, registry, or
material-path changes. New courses do not need a legacy dump once a direct
course creation/import command is added.

Checks:

```sh
uv run ruff check tracker_api
uv run mypy tracker_api
```
