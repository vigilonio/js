import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSearchDirs, findNearestPackageJson } from "../packageJson.js";

let root: string;

function write(relative: string, content: unknown) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    typeof content === "string" ? content : JSON.stringify(content),
  );
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "vigilon-pkg-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("findNearestPackageJson", () => {
  it("prefers the package closest to the entry script over the monorepo root", () => {
    write("package.json", { name: "monorepo-root", version: "0.0.0" });
    write("packages/api/package.json", { name: "@acme/api", version: "1.2.3" });
    const entry = write("packages/api/dist/server.js", "");

    const info = findNearestPackageJson(
      defaultSearchDirs(["node", entry], root),
    );

    expect(info).toMatchObject({ name: "@acme/api", version: "1.2.3" });
  });

  it("walks past node_modules so a tool binary resolves to the app package", () => {
    write("package.json", { name: "my-next-app" });
    write("node_modules/next/package.json", { name: "next", version: "15.0.0" });
    const entry = write("node_modules/next/dist/bin/next", "");

    const info = findNearestPackageJson(
      defaultSearchDirs(["node", entry], root),
    );

    expect(info?.name).toBe("my-next-app");
  });

  it("falls back to the working directory when the entry is not a file", () => {
    write("package.json", { name: "from-cwd" });

    const dirs = defaultSearchDirs(["node", "console.log(1)"], root);

    expect(dirs).toEqual([root]);
    expect(findNearestPackageJson(dirs)?.name).toBe("from-cwd");
  });

  it("walks past malformed files and files with neither name nor version", () => {
    write("package.json", { name: "outer", version: "2.0.0" });
    write("a/package.json", "{ not json");
    write("a/b/package.json", { type: "module", private: true });

    expect(findNearestPackageJson([path.join(root, "a/b")])).toMatchObject({
      name: "outer",
      version: "2.0.0",
    });
  });

  it("uses a version-only package.json as the manifest without inheriting a parent's name", () => {
    write("package.json", { name: "parent", version: "2.0.0" });
    write("app/package.json", { private: true, version: "1.2.3" });

    const info = findNearestPackageJson([path.join(root, "app")]);

    expect(info?.version).toBe("1.2.3");
    expect(info?.name).toBeUndefined();
  });

  it("treats whitespace-only names and versions as absent", () => {
    write("package.json", { name: "parent", version: "2.0.0" });
    write("blank/package.json", { name: "   ", version: " " });
    write("named/package.json", { name: "  padded  ", version: " 3.0.0 " });

    expect(findNearestPackageJson([path.join(root, "blank")])).toMatchObject({
      name: "parent",
      version: "2.0.0",
    });
    expect(findNearestPackageJson([path.join(root, "named")])).toMatchObject({
      name: "padded",
      version: "3.0.0",
    });
  });

  it("returns undefined when no package.json declares a name or version", () => {
    write("a/package.json", { private: true });

    expect(findNearestPackageJson([path.join(root, "a")])).toBeUndefined();
  });
});
