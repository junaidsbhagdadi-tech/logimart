// Deploy guard — run at the very end of `npm run build`. Fails (exit 1) if any build artifact
// is missing, so the deploy chain (`npm run build && pm2 restart …`) aborts BEFORE the restart.
// The previously-running app stays up instead of restarting into a 404 (missing web/dist) state.
// Paths resolve from this script's own location, so the current working directory doesn't matter.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ['apps/web/dist/index.html', 'web frontend (index.html)'],
  ['apps/api/dist/main.js', 'api server (main.js)'],
];

let ok = true;
for (const [rel, label] of targets) {
  const abs = join(root, rel);
  if (!existsSync(abs) || statSync(abs).size === 0) {
    console.error(`  ✗ MISSING: ${label}  ->  ${rel}`);
    ok = false;
  } else {
    console.log(`  ✓ ${label}`);
  }
}

if (!ok) {
  console.error('\nBUILD INCOMPLETE — deploy aborted. The server was NOT restarted, so the');
  console.error('previous version stays live. Fix the build error above (often out-of-memory on');
  console.error('a small box — add swap), then re-run the deploy.\n');
  process.exit(1);
}
console.log('\n✓ Build verified — safe to restart.\n');
