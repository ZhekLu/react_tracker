# Prompt templates

Edit [`promptTemplates.json`](./promptTemplates.json) to change the reusable
instruction appended to copied tracker context:

- `dayRequest` is appended by **Copy day prompt**.
- `discussionReviewRequest` is appended by **Copy review** in Discussions.

Keep the file valid JSON: use double quotes and escape a literal newline as
`\n`. The tracker owns the factual context and question grouping; these values
only control the final instruction sent to the tutor/reviewer.

During `npm run dev`, Vite reloads the change automatically. The always-on
production service serves a compiled frontend, so run the following after an
edit:

```bash
make build
make service-restart
```

No database migration or study-plan sync is required.
