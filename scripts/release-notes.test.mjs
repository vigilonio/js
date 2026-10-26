import assert from "node:assert/strict";
import { test } from "node:test";
import { groupFor, parseSubject, renderNotes } from "./release-notes.mjs";

test("parses conventional subjects, breaking changes, and squash PR numbers", () => {
  assert.deepEqual(parseSubject("feat(browser): Add @vigilon/browser (#12)"), {
    type: "feat",
    breaking: false,
    text: "Add @vigilon/browser",
    pull: 12,
  });
  assert.deepEqual(parseSubject("fix!: Drop Node 18"), {
    type: "fix",
    breaking: true,
    text: "Drop Node 18",
    pull: null,
  });
  assert.deepEqual(parseSubject("ci(release): Publish release notes [skip ci] (#2)"), {
    type: "ci",
    breaking: false,
    text: "Publish release notes",
    pull: 2,
  });
  assert.deepEqual(parseSubject("Update the README"), {
    type: null,
    breaking: false,
    text: "Update the README",
    pull: null,
  });
});

test("groups types under headings, with unknown types under Other changes", () => {
  assert.equal(groupFor("feat"), "Features");
  assert.equal(groupFor("doc"), "Documentation");
  assert.equal(groupFor("ci"), "Build and CI");
  assert.equal(groupFor("cleanup"), "Other changes");
  assert.equal(groupFor(null), "Other changes");
});

test("renders grouped entries, skips the release commit, and lists published packages", () => {
  const notes = renderNotes({
    repo: "owner/repo",
    tag: "v1.2.3",
    previousTag: "v1.2.2",
    published: ["@scope/a", "@scope/b"],
    commits: [
      { sha: "a".repeat(40), subject: "chore(release): 1.2.3", packages: ["@scope/a"] },
      { sha: "b".repeat(40), subject: "fix(a): Handle empty input (#7)", packages: ["@scope/a"] },
      { sha: "c".repeat(40), subject: "feat!: New API (#6)", packages: ["@scope/a", "@scope/b"] },
      { sha: "d".repeat(40), subject: "Tidy scripts", packages: [] },
    ],
  });
  assert.equal(
    notes,
    [
      "## Features",
      "",
      "- **Breaking:** New API (`@scope/a`, `@scope/b`) ([#6](https://github.com/owner/repo/pull/6))",
      "",
      "## Fixes",
      "",
      "- Handle empty input (`@scope/a`) ([#7](https://github.com/owner/repo/pull/7))",
      "",
      "## Other changes",
      "",
      `- Tidy scripts ([ddddddd](https://github.com/owner/repo/commit/${"d".repeat(40)}))`,
      "",
      "## Packages",
      "",
      "- [`@scope/a@1.2.3`](https://www.npmjs.com/package/@scope/a/v/1.2.3)",
      "- [`@scope/b@1.2.3`](https://www.npmjs.com/package/@scope/b/v/1.2.3)",
      "",
      "**Full changelog:** https://github.com/owner/repo/compare/v1.2.2...v1.2.3",
      "",
    ].join("\n"),
  );
});

test("says so when a release has no changes", () => {
  const notes = renderNotes({
    repo: "owner/repo",
    tag: "v1.0.1",
    previousTag: "v1.0.0",
    published: ["@scope/a"],
    commits: [{ sha: "a".repeat(40), subject: "chore(release): 1.0.1", packages: [] }],
  });
  assert.match(notes, /^No changes since v1\.0\.0/);
});
