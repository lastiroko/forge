# Todo Items API (Junior)

## Scenario
Build a small backend service that manages a list of to-do items over HTTP. The contract is defined in `openapi.yaml` in this folder — implement it exactly.

## Requirements
- `GET /health` returns `200 {"status": "ok"}`.
- `GET /items` returns `200` with a JSON array of all items.
- `POST /items` creates an item from `{"title": "..."}` and returns `201` with the created item (`id`, `title`, `done: false`). If `title` is missing or empty, return `400 {"error": "title is required"}`.
- `GET /items/{id}` returns `200` with the item, or `404 {"error": "not found"}` if it does not exist.
- `PATCH /items/{id}` accepts `{"done": true|false}`, updates the item, and returns `200` with the updated item. Returns `404 {"error": "not found"}` if the item does not exist.
- `DELETE /items/{id}` deletes the item and returns `204` with no body, or `404 {"error": "not found"}` if it does not exist.
- Requests to a path/method combination that doesn't exist (for example `DELETE /items`) should return `405`, not `500`.

## Constraints
- `GET /health` must respond in under 500ms.
- Emit one structured JSON log line per request (method, path, status) to stdout. At least half of your log output must be valid JSON lines — turn off your framework's default plain-text access log if it has one.

## Grading
Your submission is graded on:
- **Functional (60%)** — the behaviors above, checked over HTTP.
- **Contract (15%)** — responses conform to `openapi.yaml`.
- **Robustness (15%)** — sensible status codes for bad input and edge cases.
- **Quality (10%)** — response time and structured logging, described above.
