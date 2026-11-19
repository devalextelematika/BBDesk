import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

// engines.bbPluginSdk is what BB enforces for other users. The exact SDK pin in
// package.json only selects the build-time declarations, so verify that the
// plugin still typechecks and passes its tests on the oldest SDK it accepts.
const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const range = manifest.engines?.bbPluginSdk ?? "";
const floor = /^>=\s*(\d+\.\d+\.\d+)/.exec(range)?.[1];
if (!floor) throw new Error(`engines.bbPluginSdk must start with an explicit ">=x.y.z" floor; found "${range}".`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", windowsHide: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

let status = 1;
try {
  status = run(npm, ["install", "--no-save", "--no-audit", "--no-fund", `@get-bb/plugin-sdk@${floor}`]);
  if (status === 0) status = run(npm, ["run", "typecheck"]);
  if (status === 0) status = run(npm, ["test"]);
} finally {
  // Restore the pinned SDK from the lockfile, whatever the outcome.
  const restored = run(npm, ["install", "--no-audit", "--no-fund"]);
  if (restored !== 0) status ||= restored;
}
console.log(status === 0 ? `\nSDK floor ${floor} (${range}): typecheck and tests passed.` : `\nSDK floor ${floor} (${range}): check failed.`);
process.exitCode = status;
