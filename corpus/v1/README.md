# Grouping corpus, version 1

- `manifest.json`: the corpus version, the page origin (`https://corpus.vigilon.test`), the SDK and Playwright versions, each engine's version, the builds, the case IDs, and `unreported`: events an engine never sent, as `<build>/<engine>/<case>`.
- `builds/<build>/`: the files each build served. Source-mapped builds carry `//# debugId=` comments and `.map` files with a matching `debugId`.
- `events/<build>/<engine>/<case>.json`: the request body `@vigilon/browser` sent for that case (format `vigilon.browser.event@1`), holding one event. Event IDs, timestamps, `sentAt`, and session IDs are fixed values; everything else is what the browser produced.
- `expectations.json`: the bug each case is, and the accepted exceptions.

## Expected outcomes

Every pair of events has one expected outcome:

- **must-join**: both events are the same bug, and grouping must put them in one group;
- **must-separate**: they are different bugs, and grouping must keep them apart;
- **accepted-collision**: different bugs that grouping may merge, because the events carry nothing that tells them apart;
- **accepted-split**: the same bug that grouping may split, because an engine leaves out a value the others report, or the two events group on different branches.

`bugs` maps each case to a bug. Two events whose cases map to the same bug are a must-join pair, and two that map to different bugs are a must-separate pair, unless an entry in `accepted` applies:

- an `accepted-collision` entry applies to every pair of events of different bugs that both match its `events` selector;
- an `accepted-split` entry applies to every pair of events of the same bug where one matches `events` and the other matches `versus`.

A selector matches an event when its case, engine, and build are in the selector's `cases`, `engines`, and `builds`; a missing list matches everything. Every accepted entry names a `reason` from `reasons`.

`branches` says which builds group on the frames branch (source-mapped, with debug IDs) and which on the fallback branch (no source maps). An accepted outcome is allowed, not required: grouping passes when every must-join and must-separate pair holds, and the accepted pairs that actually merged or split are worth counting, since fewer is better.
