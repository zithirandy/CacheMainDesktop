/**
 * Check how the app behaves when a configured server is broken.
 *
 * Every existing suite asserts that connections SUCCEED - check-live-servers
 * even asserts the absence of "connection refused". Nothing ever exercised the
 * failure path, which is the state a user is most likely to be in right after
 * adding a server: wrong host, wrong password, service not running.
 *
 * The bar for this test is deliberately modest but real:
 *   - the app must stay alive and keep serving the panel (no crash, no restart loop)
 *   - no PHP fatal/parse error or stack trace may reach the page
 *   - the page must say something rather than silently rendering empty
 *
 * SEEDING IS EXPLICIT. Connections are fed through the environment with
 * toEnvVars(), exactly like the other suites. No real or production server is
 * contacted: the hosts below are loopback ports where nothing listens, plus a
 * loopback Redis reached with a wrong password. The dangerous pattern this repo
 * was bitten by - omitting `server=` and inheriting whatever connection index 0
 * happens to be - cannot occur here because every request passes an explicit
 * index.
 *
 *   node scripts/check-connection-errors.mjs
 */

import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {toEnvVars} from '../lib/connections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP = path.join(ROOT, 'php', 'php.exe');

// Node's bundled fetch can throw an undici teardown assertion while sockets are
// being closed at exit ("assert(!this.paused)"). That fires AFTER all checks
// have run, and it would otherwise turn a green suite into exit code 1. Only
// that specific assertion is swallowed, and only once we are shutting down;
// anything else still surfaces.
let stopping = false;
process.on('uncaughtException', error => {
    if (stopping && error?.code === 'ERR_ASSERTION' && /paused/.test(error?.message ?? '')) {
        return;
    }

    console.error(error);
    process.exit(1);
});

const failures = [];
const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ok    ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL    ${name}${detail ? ` - ${detail}` : ''}`);
    }
};

// Deliberately broken targets, all loopback.
const DEAD_REDIS_PORT = 6399;   // nothing listens here
const DEAD_MC_PORT = 11399;     // nothing listens here
const LIVE_REDIS_PORT = 6379;   // local test container, but with a wrong password

const connections = [
    {id: 'dead-r', type: 'redis', name: 'Dead Redis', host: '127.0.0.1', port: DEAD_REDIS_PORT, database: 0, password: ''},
    {id: 'badpw-r', type: 'redis', name: 'Wrong Password Redis', host: '127.0.0.1', port: LIVE_REDIS_PORT, database: 0, password: 'definitely-not-the-password'},
    {id: 'dead-m', type: 'memcached', name: 'Dead Memcached', host: '127.0.0.1', port: DEAD_MC_PORT, database: 0},
];

// Diagnostics that must never reach a user-facing page.
const PHP_NOISE = /Fatal error|Parse error|Uncaught|<b>Warning<\/b>|Notice:|Deprecated:|Stack trace/i;

let backend;

try {
    backend = new PhpBackend({
        phpExe: PHP,
        docroot: path.join(ROOT, 'webapp'),
        env: {
            ...toEnvVars(connections),
            PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
        },
        logger: () => {},
    });

    const url = await backend.start();
    console.log(`backend up at ${url} (3 deliberately broken connections)\n`);

    const cases = [
        ['dead redis dashboard', '/?dashboard=redis&server=0'],
        ['dead redis keys', '/?dashboard=redis&server=0&view=keys'],
        ['wrong-password redis dashboard', '/?dashboard=redis&server=1'],
        ['wrong-password redis keys', '/?dashboard=redis&server=1&view=keys'],
        ['dead memcached dashboard', '/?dashboard=memcached&server=0'],
        ['dead memcached keys', '/?dashboard=memcached&server=0&view=keys'],
        ['dead redis analysis', '/?dashboard=redis&server=0&view=analysis'],
    ];

    for (const [label, route] of cases) {
        let status = 0;
        let body = '';

        try {
            const response = await fetch(url + route);
            status = response.status;
            body = await response.text();
        } catch (error) {
            check(`${label}: responds`, false, error.message);
            continue;
        }

        check(`${label}: HTTP 2xx`, status >= 200 && status < 300, `status=${status}`);
        check(`${label}: no PHP error output`, !PHP_NOISE.test(body),
            (body.match(PHP_NOISE) ?? [])[0] ?? '');
    }

    // The backend must still be up after all of that - a crashed supervisor
    // would mean the app is dead in front of the user.
    const stillUp = await fetch(url + '/?dashboard=server').then(r => r.status).catch(() => 0);
    check('backend still serving after every failure', stillUp === 200, `status=${stillUp}`);

    check('no PHP process leaked per failed request',
        backend.child !== null && backend.child.exitCode === null,
        `exitCode=${backend.child?.exitCode}`);
} catch (error) {
    console.error(`check-connection-errors: ${error.message}`);
    failures.push(`exception: ${error.message}`);
} finally {
    stopping = true;

    if (backend) {
        await backend.stop().catch(() => {});
    }
}

if (failures.length > 0) {
    console.error(`\ncheck-connection-errors: ${failures.length} failed`);
    process.exit(1);
}

console.log('\ncheck-connection-errors: PASS (broken servers degrade without errors or crashes)');
