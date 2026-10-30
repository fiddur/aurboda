import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = fileURLToPath(new URL(".", import.meta.url));

const viewportHeightUnit = /\b\d*\.?\d+(?:[dsl]?vh|vmin)\b/i;

const allowlist: Record<string, string> = {
  "style.css":
    "root heights (html/body/#app are pinned by the native viewport fix); .app-content above 60em is #1356",
  "components/Sidebar.css": "the sidebar is hidden in embed mode",
  "pages/Meals/style.css":
    "sticky panel inside @media (min-width: 900px): tablets only, #1356",
  "pages/Meals/MealDetail.css":
    "sticky panel inside @media (min-width: 900px): tablets only, #1356",
};

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });

describe("web CSS", () => {
  it("uses no viewport-height units outside the allowlist", () => {
    const offenders = cssFiles(srcDir)
      .map((path) => relative(srcDir, path).split("\\").join("/"))
      .filter((file) => !(file in allowlist))
      .flatMap((file) =>
        readFileSync(join(srcDir, file), "utf8")
          .split("\n")
          .flatMap((line, i) =>
            viewportHeightUnit.test(line)
              ? [`${file}:${i + 1}: ${line.trim()}`]
              : [],
          ),
      );

    expect(
      offenders,
      'The Android WebView resolves vh units to 0; size from % or flex instead (see docs/android-app.md, "Page height and vh units").',
    ).toEqual([]);
  });

  it("allowlists only files that exist and still use viewport-height units", () => {
    const files = new Set(
      cssFiles(srcDir).map((path) =>
        relative(srcDir, path).split("\\").join("/"),
      ),
    );
    const stale = Object.keys(allowlist).filter(
      (file) =>
        !files.has(file) ||
        !viewportHeightUnit.test(readFileSync(join(srcDir, file), "utf8")),
    );
    expect(stale).toEqual([]);
  });
});
