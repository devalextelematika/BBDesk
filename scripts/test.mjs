import { readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
function discover(dir, nested = false) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) return (nested || entry.name === 'tests') ? discover(file, true) : [];
    return /\.test\.(?:ts|tsx|mjs)$/.test(entry.name) ? [file] : [];
  }).sort();
}
// Enumerate files in JS: shell glob expansion differs on Windows and Unix.
// Default process isolation prevents SDK module caches crossing file boundaries.
const files = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--import', './scripts/test-loader.mjs', '--test', '--test-concurrency=1', ...(files.length ? files : discover(''))], { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
