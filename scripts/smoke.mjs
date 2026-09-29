/**
 * Headless smoke test: boots the real PHP backend with an env-injected
 * connection list and asserts the dashboard renders.
 *
 *   node scripts/smoke.mjs
 */

import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {toEnvVars} from '../lib/connections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Killing the PHP server tears down sockets undici still has parsers attached
// to, which trips an internal assertion in Node's bundled undici. It happens
// after the checks are done, so it is safe to ignore for the exit code.
process.on('uncaughtException', error => {
    if (stopping && error?.code === 'ERR_ASSERTION') {
        return;
    }

    console.error(error);
    process.exit(1);
});

let stopping = false;

const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok  ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

async function main() {
    const tmp = path.join(ROOT, 'webapp', 'tmp');
    await mkdir(path.join(tmp, 'metrics'), {recursive: true});
    await mkdir(path.join(tmp, 'twig'), {recursive: true});

    const connections = [
        {id: 'smokeredis', type: 'redis', name: 'Smoke Redis', host: '127.0.0.1', port: 6399, database: 0},
        // A second redis connection so the server selector actually renders
        // (upstream hides it for a single connection of one type).
        {id: 'smokeredis2', type: 'redis', name: 'Smoke Redis Two', host: '127.0.0.1', port: 6398, database: 0},
        {id: 'smokemc', type: 'memcached', name: 'Smoke Mc', host: '127.0.0.1', port: 11299, database: 0},
        {id: 'smokemc2', type: 'memcached', name: 'Smoke Mc Two', host: '127.0.0.1', port: 11298, database: 0},
    ];

    const backend = new PhpBackend({
        phpExe: path.join(ROOT, 'php', 'php.exe'),
        docroot: path.join(ROOT, 'webapp'),
        env: {
            ...toEnvVars(connections),
            PCA_TMPDIR: tmp,
            PCA_METRICSDIR: path.join(tmp, 'metrics'),
            PCA_TWIGCACHE: path.join(tmp, 'twig'),
            PCA_HASH: 'smoke',
        },
        logger: line => console.log(`       ${line}`),
    });

    console.log('smoke: starting backend...');
    const url = await backend.start();
    console.log(`smoke: backend at ${url}`);

    try {
        const root = await fetch(url).then(r => {
            check('root answers 200', r.ok, `status ${r.status}`);
            return r.text();
        });

        check('page mentions phpCacheAdmin', root.includes('phpCacheAdmin'));

        const redis = await fetch(`${url}/?dashboard=redis`).then(r => r.text());
        check('redis dashboard renders both connection names', redis.includes('Smoke Redis') && redis.includes('Smoke Redis Two'),
            'the env-injected connections should be selectable');
        check('redis dashboard does not show "No servers"', !redis.includes('No servers'));

        const memcached = await fetch(`${url}/?dashboard=memcached`).then(r => r.text());
        check('memcached dashboard renders both connection names', memcached.includes('Smoke Mc') && memcached.includes('Smoke Mc Two'));

        const panels = await fetch(`${url}/?dashboard=redis&ajax&panels`).then(r => r.json());
        check('ajax panels return json', typeof panels === 'object' && panels !== null);

        const css = await fetch(`${url}/assets/css/styles.css`).then(r => r.status);
        check('stylesheet served', css === 200);
    } finally {
        console.log('smoke: stopping backend...');
        stopping = true;
        await backend.stop();
    }

    if (failures.length > 0) {
        console.error(`smoke: ${failures.length} check(s) failed.`);
        process.exit(1);
    }

    console.log('smoke: all checks passed.');
}

main().catch(error => {
    console.error(`smoke: ${error.message}`);
    process.exit(1);
});
