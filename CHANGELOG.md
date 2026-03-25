# Changelog

## 0.3.0 - 2026-03-25

- Added richer command help with examples, required-flag metadata, and machine-readable help payloads.
- Improved agent-facing failure messages so missing required flags fail fast with actionable retry guidance.
- Added `--dry-run` previews for calendar mutation commands.
- Made convergent mutation commands idempotent when the requested end state is already satisfied.
- Fixed login default return-path handling so it follows the provided username.
- Added automated tests covering CLI help/error behavior and write-command dry-run/no-op semantics.
