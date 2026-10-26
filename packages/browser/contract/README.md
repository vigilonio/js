# Browser event format

`v1/` describes the request body the SDK sends, `vigilon.browser.event@1`:

- `vigilon.browser.event@1.schema.json`: the JSON Schema;
- `fixtures/valid/`: example envelopes that conform to it;
- `manifest.json`: the version of the format these files describe.

The conformance tests validate every envelope the SDK builds against the
schema and type-check every example against the SDK's types. When the format
changes, these files change with a new version in `manifest.json`, and the SDK
is updated to match before its tests pass.
