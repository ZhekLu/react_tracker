# React Tracker Backend

Tiny Python API skeleton for the React tracker.

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/backend
python3 -m tracker_api.main
```

Endpoints:

- `GET /api/health`
- `GET /api/courses`
- `GET /api/dumps`
- `POST /api/dev/seed`

The database is created at `react_tracker/data/tracker.db`.

Import a static tracker export:

```sh
cd /Users/eugene/Documents/Thesis/Tracker/react_tracker/backend
python3 -m tracker_api.import_dump "/Users/eugene/Downloads/study-tracker-2026-06-18 (1).json"
```
