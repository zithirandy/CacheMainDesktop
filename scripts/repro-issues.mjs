/**
 * Read-only reproduction against the real servers, from DLFifthApi sources:
 *  - Redis 192.0.2.122:6379 (db 0 vs db 5 tab bar)
 *  - Memcached 192.0.2.233:11211 (rendering only)
 *
 * Only INFO / SELECT / stats reads are issued - no key is ever touched.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {toEnvVars} from '../lib/connections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.on('uncaughtException', () => process.exit(0));

const connections = [
    {id: 'prod', type: 'redis', name: 'Prod', host: '192.0.2.122', port: 6379, database: 0, password: '***REDACTED***'},
    {id: 'mc', type: 'memcached', name: 'Mc', host: '192.0.2.233', port: 11211, database: 0},
    {id: 'prod2', type: 'redis', name: 'Prod2', host: '192.0.2.122', port: 6380, database: 0, password: '***REDACTED***'},
];

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        ...toEnvVars(connections),
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();
console.log('backend', url);

async function probe(label, query) {
    const html = await fetch(`${url}/${query}`).then(r => r.text());
    const hasTabs = html.includes('Slow Log') && html.includes('Analysis');
    const alert = html.match(/alert[^>]*>\s*<[^>]*>\s*<span[^>]*>([^<]{0,200})/)?.[1]
        ?? html.match(/<p[^>]*>([^<]{5,200})<\/p>/)?.[1] ?? '';
    console.log(`${label}: tabs=${hasTabs} len=${html.length} alert="${alert.slice(0, 120)}"`);
    return {html, hasTabs};
}

await probe('redis db0  ', 'index.php?dashboard=redis');
await probe('redis db5  ', 'index.php?dashboard=redis&db=5');
await probe('redis db=99', 'index.php?dashboard=redis&db=99');
await probe('memcached  ', 'index.php?dashboard=memcached');

// Panels (the sidebar cards) for redis db0 vs db5, timing them.
for (const db of [0, 5]) {
    const t0 = Date.now();
    const body = await fetch(`${url}/index.php?dashboard=redis&db=${db}&ajax&panels`).then(r => r.text());
    console.log(`panels db${db}: ${Date.now() - t0}ms ${body.slice(0, 140)}`);
}

await backend.stop();
process.exit(0);
