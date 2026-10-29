# Grouping corpus

Browser errors as real browsers report them, with the grouping each pair of them should get. It exists to test error grouping: whether two events are the same bug and should land in one group, or different bugs that should stay apart. It is not a published package.

- `app/` is a small fixture app. Each case in `app/src/cases.js` runs one bug: a helper thrown from different callers, recursion at different depths, errors on both sides of an `await`, `cause` chains, `AggregateError`, a React component failing under different trees, two bugs with the same message, and a catalogue of common `TypeError`, `ReferenceError`, `SyntaxError`, and `RangeError` messages in literal and computed form.
- `v1/` is the generated corpus and the expected outcomes; [`v1/README.md`](v1/README.md) describes its format.

## Regenerating

```bash
pnpm build
pnpm --filter @vigilon/browser exec playwright install chromium firefox webkit
pnpm corpus:generate
```

The generator builds the app three ways (two source-mapped releases with debug IDs from `@vigilon/bundler-plugins`, and one unmapped build), loads every case in Playwright's Chromium, Firefox, and WebKit, and rewrites `v1/builds/`, `v1/events/`, and `v1/manifest.json`. Runs are reproducible: a second run with the same browsers writes the same bytes. A browser update can change error messages and stacks, so regenerate after a Playwright upgrade, review the diff, and update `v1/expectations.json` where a change calls for it.

`pnpm test` checks the committed corpus without a browser: every case has an event per build and engine (or is listed as unreported), every event matches the browser event format, every debug ID points at a committed script and source map, and every pair of events resolves to exactly one expected outcome.
