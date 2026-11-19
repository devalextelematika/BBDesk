import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

export const corruptText = /(?:Р[А-Яа-яЁёЀ-ӿ -¿]|С[Ђ-Џ\u0080-¿‐-‿]){2,}|Рџ|Рњ|Рќ|РЎ|СЃ|С‚|вЂ[¦”–]|[ÐÑ][\u0080-¿]|[�\u0098]/u;

// Discover files instead of listing them, so new modules are checked too. Walk the
// directory rather than asking git: a ZIP or npm copy has no .git directory.
const root = new URL("..", import.meta.url);
const rootPath = decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, "$1");
const skipDirectories = new Set(["node_modules", "dist", ".git", "coverage", "test-results", "verification", "local"]);
const textFile = /\.(?:ts|tsx|mjs|js|css|md|json|yml|yaml|svg)$/;
function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return skipDirectories.has(entry.name) ? [] : discover(path);
    // Machine-local notes (gitignored) and the lockfile are not authored sources.
    if (!textFile.test(entry.name) || entry.name.endsWith("-verification.md") || entry.name === "package-lock.json") return [];
    return [relative(rootPath, path).split(sep).join("/")];
  });
}
const files = discover(rootPath).sort();

// These files hold the mojibake patterns on purpose, to detect them.
const mojibakeFixtures = new Set(["scripts/check-ui.mjs", "tests/ui/catalog-navigation.test.mjs"]);
for (const name of files.filter(name => !mojibakeFixtures.has(name))) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(join(rootPath, name)));
  if (corruptText.test(text)) throw new Error("Corrupt text encoding in " + name);
}

// User-visible text lives in the language catalogs. Tests may use any text, and
// the language setting names each language in its own script.
const authoredTextAllowed = new Set(["i18n.ts"]);
const sources = files.filter(name => /\.tsx?$/.test(name) && !name.startsWith("locales/") && !name.startsWith("tests/")
  && !/\.test\.tsx?$/.test(name) && !authoredTextAllowed.has(name));
for (const name of sources) {
  if (/[Ѐ-ӿ]/u.test(readFileSync(join(rootPath, name), "utf8"))) throw new Error("Move authored text into the language catalogs: " + name);
}
console.log(`UTF-8 check passed for ${files.length} files; localized source check passed for ${sources.length} modules.`);
