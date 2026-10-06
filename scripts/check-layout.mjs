/**
 * One-off helper used during development: boot the backend and assert the
 * reworked layout markers are present in the rendered page.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// An uncaught error means the check never ran (backend failed to start, fetch
// failed). Exiting 0 there reported a broken environment as a passing layout.
process.on('uncaughtException', error => {
    console.error('check-layout: could not complete:', error?.message ?? error);
    process.exit(1);
});

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        PCA_REDIS_0_HOST: '127.0.0.1',
        PCA_REDIS_0_NAME: 'Layout check',
        PCA_REDIS_1_HOST: '127.0.0.1',
        PCA_REDIS_1_NAME: 'Second',
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();
const html = await fetch(`${url}/?dashboard=redis`).then(r => r.text());

const markers = [
    'pca-sidebar', 'pca-nav-item', 'pca-workspace', 'pca-rail',
    'pca-open-connections', 'data-theme="dark"', 'CacheMain',
    'h-screen overflow-hidden', 'Server</div>', 'Second',
];

let failed = false;
for (const marker of markers) {
    const ok = html.includes(marker);
    console.log(`${ok ? 'ok  ' : 'MISS'} ${marker}`);
    failed ||= !ok;
}

await backend.stop();
process.exit(failed ? 1 : 0);
