// Zero-gap web deploy: vite builds into dist-next while the live site keeps serving dist; then the two
// folders are swapped by rename (milliseconds), so nobody hits "index.html not found" mid-deploy.
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const next = join(web, 'dist-next'), live = join(web, 'dist'), old = join(web, 'dist-old');
if (!existsSync(join(next, 'index.html'))) { console.error('swap-dist: dist-next/index.html missing — keeping the live build'); process.exit(1); }
rmSync(old, { recursive: true, force: true });
if (existsSync(live)) renameSync(live, old);
renameSync(next, live);
rmSync(old, { recursive: true, force: true });
console.log('swap-dist: new web build is live');
