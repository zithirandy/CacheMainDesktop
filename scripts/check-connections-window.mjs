/**
 * Exercise the Connections window - the app's most important UI, and the one
 * flow no automated test had ever touched.
 *
 * Without this window a user cannot add a server at all, yet every existing
 * suite either checked that its markup exists (check-layout, check-contrast) or
 * bypassed it by writing connections.json through the environment
 * (check-live-servers). The two-stage save (Apply stages, Save & Apply
 * persists + restarts the backend) in particular had no coverage.
 *
 * Safety: this launches its own app instance with an ISOLATED user-data
 * directory, so the real %APPDATA%/CacheMainDesktop/connections.json is never
 * read or written. The directory is removed afterwards.
 *
 *   node scripts/check-connections-window.mjs [debugPort]
 */

import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const debugPort = process.argv[2] ?? '19355';
const exe = path.join(ROOT, 'dist', 'win-unpacked', 'CacheMainDesktop.exe');

if (!existsSync(exe)) {
    console.error(`check-connections-window: no packaged app at ${exe}`);
    process.exit(1);
}

// Assigned by launchIsolated(); each retry uses its own directory.
let userData = '';
let connectionsFile = '';

const failures = [];
const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ok    ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL    ${name}${detail ? ` - ${detail}` : ''}`);
    }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Poll the DevTools endpoint until the app is up, or give up.
 *
 * Reports why it gave up: an isolated profile means a cold first run (Chromium
 * has to create its whole profile tree), and a blunt "no targets appeared" hid
 * whether the process had died or was merely slow.
 */
async function waitForTargets(timeoutMs = 75_000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = 'not attempted';

    while (Date.now() < deadline) {
        if (child && child.exitCode !== null) {
            return {targets: null, reason: `app exited early with code ${child.exitCode}`};
        }

        try {
            const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();

            if (list.some(t => t.type === 'page')) {
                return {targets: list, reason: null};
            }

            lastError = `endpoint answered, ${list.length} targets, none of type page`;
        } catch (error) {
            lastError = error.message;
        }

        await sleep(700);
    }

    return {targets: null, reason: `timed out after ${timeoutMs}ms (last: ${lastError})`};
}

/** Minimal CDP client for one target. */
async function attach(wsUrl) {
    const socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, {once: true});
        socket.addEventListener('error', () => reject(new Error('ws error')), {once: true});
    });

    let nextId = 1;
    const pending = new Map();

    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        const entry = pending.get(message.id);
        if (entry) {
            pending.delete(message.id);
            message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
        }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method, params}));
        setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 30_000);
    });

    await send('Runtime.enable');

    return {
        send,
        evaluate: async expression => {
            const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
            if (result.exceptionDetails) {
                throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
            }
            return result.result.value;
        },
        close: () => socket.close(),
    };
}

/**
 * Environment for a spawned Electron binary.
 *
 * ELECTRON_RUN_AS_NODE makes an Electron executable behave as plain Node: it
 * runs no main script that opens windows, prints nothing, and exits. Any
 * harness that exports it (DSH does) therefore breaks every attempt to launch
 * the packaged app, which surfaced here only as "exited early with code 9".
 * Confirmed by A/B on identical arguments: with the variable the process dies
 * silently, without it the backend reaches "ready" and serves the page.
 *
 * @returns {NodeJS.ProcessEnv}
 */
function electronEnv() {
    const env = {...process.env};

    delete env.ELECTRON_RUN_AS_NODE;

    return env;
}

/**
 * Launch a fresh isolated instance and return its page targets.
 *
 * Retries: when several app instances are started in quick succession (this
 * suite runs after live-servers in verify-all), the new process can die at once
 * with Chromium exit code 9 even though nothing about the arguments is wrong -
 * the same isolated spawn succeeds 5/5 when run on its own. That is a transient
 * startup conflict, not a real defect, so retry a couple of times before
 * reporting it; each attempt gets its own user-data directory to avoid reusing
 * a half-initialised profile.
 *
 * @param {number} attempts
 * @returns {Promise<{targets: Array|null, reason: string|null, userData: string}>}
 */
async function launchIsolated(attempts = 3) {
    let reason = null;
    let attemptDir = '';

    for (let attempt = 1; attempt <= attempts; attempt++) {
        attemptDir = mkdtempSync(path.join(tmpdir(), `pca-conn-${attempt}-`));

        child = spawn(exe, [
            `--remote-debugging-port=${debugPort}`,
            `--user-data-dir=${attemptDir}`,
        ], {stdio: ['ignore', 'pipe', 'pipe'], env: electronEnv()});

        child.stderr.on('data', d => {
            stderr += d.toString();
        });

        const {targets, reason: failure} = await waitForTargets();

        if (targets) {
            return {targets, reason: null, userData: attemptDir};
        }

        reason = failure;

        // Only a transient startup death is worth retrying.
        if (!/exited early/.test(failure ?? '')) {
            break;
        }

        console.log(`       attempt ${attempt} failed (${failure}); retrying`);

        try {
            rmSync(userData, {recursive: true, force: true});
        } catch {
            // best effort
        }

        await sleep(2000);
    }

    return {targets: null, reason, userData};
}

let child;
let stderr = '';

try {
    const launched = await launchIsolated(3);
    const initial = launched.targets;
    userData = launched.userData;
    connectionsFile = path.join(userData, 'connections.json');

    console.log(`launching an isolated instance\n  user data: ${userData}\n`);

    if (!initial) {
        // Print what the process actually said. Without this the only clue is a
        // bare exit code, which is how this failure stayed unexplained.
        const tail = stderr.trim().split('\n').filter(Boolean).slice(-12).join('\n      ');
        console.error(`       stderr:\n      ${tail || '(empty)'}`);
        check('app started', false, launched.reason ?? 'unknown');
        throw new Error(`app did not start: ${launched.reason}`);
    }

    check('app started in an isolated profile', true);

    // --- open the Connections window the way a user does -------------------
    const main = initial.find(t => t.url.startsWith('http://127.0.0.1:'));

    if (!main) {
        check('main window present', false, JSON.stringify(initial.map(t => t.url)));
        throw new Error('no main window target');
    }

    const mainClient = await attach(main.webSocketDebuggerUrl);

    // Give the page a moment: a target can exist before its scripts have run,
    // and querying too early makes every UI assertion fail for the wrong reason.
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
        ready = await mainClient.evaluate('document.readyState === "complete" && !!document.getElementById("pca-open-connections")');
        if (!ready) {
            await sleep(700);
        }
    }

    const pageState = await mainClient.evaluate(`JSON.stringify({
        url: location.href,
        readyState: document.readyState,
        title: document.title,
        hasBridge: !!window.pcaDesktop,
        hasConnectionsBtn: !!document.getElementById('pca-open-connections'),
        bodyStart: document.body ? document.body.innerText.slice(0, 160) : null,
        scriptCount: document.scripts.length,
    })`);

    console.log(`       main page: ${pageState}`);

    const hasBridge = await mainClient.evaluate('!!(window.pcaDesktop && window.pcaDesktop.connections)');
    check('page exposes the desktop bridge', hasBridge === true,
        hasBridge === true ? '' : `state=${pageState}`);

    const clicked = await mainClient.evaluate(`(() => {
        const btn = document.getElementById('pca-open-connections');
        if (!btn) return 'button missing';
        btn.click();
        return 'clicked';
    })()`);
    check('Connections button exists and was clicked', clicked === 'clicked', String(clicked));

    mainClient.close();
    await sleep(2500);

    const withConnections = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    const connTarget = withConnections.find(t => t.url.includes('connections.html'));

    check('Connections window opened', !!connTarget,
        JSON.stringify(withConnections.map(t => t.title)));

    if (!connTarget) {
        throw new Error('no connections window');
    }

    const conn = await attach(connTarget.webSocketDebuggerUrl);

    const empty = await conn.evaluate(`document.getElementById('empty') && !document.getElementById('empty').classList.contains('hidden')`);
    check('starts on the empty state', empty === true);

    // --- stage a connection via the form -----------------------------------
    const staged = await conn.evaluate(`(() => {
        document.getElementById('add').click();
        const set = (id, value) => {
            const el = document.getElementById(id);
            el.value = value;
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
        };
        set('f-name', 'Isolated Test Redis');
        set('f-host', '127.0.0.1');
        set('f-port', '6379');
        document.getElementById('editor-apply').click();
        return {
            rows: document.querySelectorAll('#list .conn').length,
            status: document.getElementById('status').textContent,
            editorHidden: document.getElementById('editor').classList.contains('hidden'),
        };
    })()`);

    check('Apply stages the row in the list', staged.rows === 1, JSON.stringify(staged));
    check('staged state warns that it is not saved yet',
        /not saved yet/i.test(staged.status), JSON.stringify(staged.status));
    check('Apply does not write connections.json yet', !existsSync(connectionsFile));

    // --- Save & Apply persists it -----------------------------------------
    await conn.evaluate(`document.getElementById('save').click()`);
    await sleep(3500);

    check('Save & Apply writes connections.json', existsSync(connectionsFile));

    if (existsSync(connectionsFile)) {
        const saved = JSON.parse(readFileSync(connectionsFile, 'utf8'));
        const entry = Array.isArray(saved) ? saved.find(c => c.name === 'Isolated Test Redis') : null;

        check('the connection was persisted with the typed values',
            !!entry && entry.type === 'redis' && entry.host === '127.0.0.1' && entry.port === 6379,
            JSON.stringify(entry));
    }

    // --- deleting it again -------------------------------------------------
    await conn.evaluate(`(() => {
        const del = document.querySelector('#list .conn [data-action="delete"]');
        if (del) { window.confirm = () => true; del.click(); }
        return true;
    })()`);
    await sleep(600);
    await conn.evaluate(`document.getElementById('save').click()`);
    await sleep(3000);

    const after = existsSync(connectionsFile)
        ? JSON.parse(readFileSync(connectionsFile, 'utf8'))
        : [];

    check('deleting a row and saving removes it',
        Array.isArray(after) && !after.some(c => c.name === 'Isolated Test Redis'),
        JSON.stringify(after));

    conn.close();
} catch (error) {
    console.error(`check-connections-window: ${error.message}`);
    failures.push(`exception: ${error.message}`);
} finally {
    if (child && child.exitCode === null) {
        child.kill();
        await sleep(1500);
    }

    try {
        rmSync(userData, {recursive: true, force: true});
    } catch {
        console.error(`note: could not remove ${userData}`);
    }
}

if (failures.length > 0) {
    console.error(`\ncheck-connections-window: ${failures.length} failed`);
    process.exit(1);
}

console.log('\ncheck-connections-window: PASS (the Connections window round-trips a server)');
