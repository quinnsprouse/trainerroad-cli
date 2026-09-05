# Working on TrainerRoad CLI

This CLI uses Lasso command contracts. There is one entrypoint, `src/bin.ts`.
Do not add a separate parser, output formatter, or command manifest.

## Before editing

- Read the relevant contract in `src/commands/` and its tests.
- For Effect APIs, use the installed `node_modules/effect/src/` documentation. This project pins Effect v4 beta.
- Never open a real session file or call TrainerRoad during automated tests. Use fixture clients, fake filesystems, or mocked fetch.

## Define commands

Register a `defineQuery` or `defineMutation` contract in `src/commands/index.ts`.
The contract owns flags, descriptions, schemas, errors, examples, and guide references.
Mark mandatory scalar flags `required: true`. The parser, `describe`, and `schema` derive that rule from the contract.

Queries use readers. Mutation plans use readers, return deterministic JSON, and contain every value apply needs.
Apply uses a writer and receives the decoded plan. Keep passwords and cookies out of plans, errors, and output.
The roster's capability types reject writers in queries and plans.

`src/operations/*.mjs` contains retained TrainerRoad domain logic. These functions return data and receive a restricted client through `src/services/operation-transport.mjs`.
They do not parse argv or write stdout. New commands use TypeScript contracts and Effect services.
Keep raw network and session-file access in the transport modules and `src/trainerroad-client.mjs`.

Browser-derived workflows declare named inputs, read requests, response selection,
and a write request in `src/domain/*-workflows.ts`. Their contract adapter and
reader/writer services own execution. Never add a raw endpoint or arbitrary JSON
request flag. Recover payloads from actual callers, validate IDs and ownership,
and keep unrelated response fields out of plans. A GET can mutate upstream state;
workout provider pushes must remain writes. Successful dispatch is `submitted`,
not verified completion. Add a read-only next action that preserves the confirmed
session, IDs, and date window. Unknown API behavior must fail closed.

Use the optional `hydrate` read stage when detail requests depend on IDs returned
by the first reads. It cannot replace initial record keys. Planned-activity batch
reads use `get(memberScopedPath, ids)` with at most 100 IDs per batch. The transport
allows that header only for read-only planned-activity requests. Match each detail
to the member's discovered IDs before using its recurrence linkage or other fields.

Use `Errors.*` for expected failures and include an actionable `fix`.
Use `next` for an optional next command. Use guide topics for domain knowledge that flags cannot explain.
Derive mutation follow-ups from the confirmed plan, preserving its session and dates. Recovery must not carry `--yes` into a new write.
Only the renderer writes terminal output. Use `Progress` for progress reporting.

Calendar writes must not retry automatically. After an uncertain write, return `cannot_write` and tell the caller to read the calendar.
Confirmation is not an atomic server transaction. Test stale state and the interval between preview and apply.

## Verify

```sh
npm run fmt
npm run check:push
```

`check:push` checks formatting, type-aware lint, types, guide freshness, both test suites, the bundle, and an isolated package.
Tests cover command parsing, output envelopes, capabilities, fixture API requests, confirmation, and local file mutations.
Guidance tests follow emitted commands through preview, confirmation, and read-only verification. The test harness rejects broken next actions, missing guide topics, and silently dropped guidance.
Add a regression test with each fix. Never skip tests or weaken lint rules to make a command pass.
The JavaScript transport exceptions in `.oxlintrc.json` are scoped to the retained client, not the TypeScript command layer.

Edit `guides/topics/*.md`, then run `node scripts/guides.mjs` to regenerate the catalog.
Update `MIGRATION.md` for changed flags or machine output. Version changes must update `package.json`, the lockfile, and `src/meta.ts`.
