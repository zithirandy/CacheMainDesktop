/**
 * Verify the Redis import path end to end through the REAL file-upload UI.
 *
 * Earlier attempts at this used Node's FormData/Blob or a hand-built multipart
 * body, and PHP reported UPLOAD_ERR_NO_FILE for both - so the import handler was
 * never actually exercised, and D2/D3 could only be checked at unit level.
 * Playwright's setInputFiles produces a genuine upload, which is what this uses.
 *
 * Covers:
 *   - D2: an imported key with a TTL keeps its lifetime (was shortened 1000x)
 *   - D3: a malformed file produces a visible message instead of silence
 *
 *   node scripts/check-redis-import-e2e.mjs [phpPort] [serverIndex]
 *
 * Screenshots go outside the repo (shotsDir()).
 */

import {execFileSync} from 'node:child_process';
import {writeFileSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {launchBrowser, shotsDir} from './lib/test-env.mjs';

const phpPort = process.argv[2] ?? process.env.PCA_PANEL_PORT ?? '50785';
const serverIndex = process.argv[3] ?? '2';
const CONTAINER = 'cmd-test-redis';
const DB = '9';

const SOURCE = 'e2e:src';
const IMPORTED = 'e2e:imported';
const TTL_SECONDS = 2000;

const BASE = `http://127.0.0.1:${phpPort}`;
const keysUrl = `${BASE}/?dashboard=redis&server=${serverIndex}`;

const redis = (...args) => execFileSync('docker',
    ['exec', CONTAINER, 'redis-cli', '-n', DB, ...args], {encoding: 'utf8'}).trim();

/**
 * Hex of a key's serialized value, for an export-format payload.
 *
 * Getting this byte-exact took several wrong turns, all recorded so nobody
 * repeats them - each one makes RESTORE fail with "DUMP payload version or
 * checksum are wrong", which looks exactly like an application bug and sent me
 * chasing the app instead of the harness:
 *   - `redis-cli --no-raw` ESCAPES non-printable bytes, turning a 26-byte dump
 *     into a 47-byte hex string;
 *   - piping through `base64` inside the container picks up the shell's newline,
 *     adding a 0x0a byte;
 *   - `{encoding: 'buffer'}` is correct, but redis-cli still appends a trailing
 *     newline after the value.
 *
 * The dump is binary plus a CRC, so it must be passed through untouched - minus
 * that final newline.
 */
function dumpHex(key) {
    const raw = execFileSync('docker',
        ['exec', CONTAINER, 'redis-cli', '-n', DB, 'DUMP', key],
        {encoding: 'buffer', maxBuffer: 1 << 20});

    // Drop redis-cli's trailing newline only; everything before it is the value.
    const dump = raw[raw.length - 1] === 0x0a ? raw.subarray(0, raw.length - 1) : raw;
    const hex = dump.toString('hex');

    if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) {
        throw new Error(`dumpHex produced something unexpected for "${key}"`);
    }

    return hex;
}

const failures = [];
const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ok    ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL    ${name}${detail ? ` - ${detail}` : ''}`);
    }
};

// --- fixture: a key whose TTL we can compare after the round trip -----------
redis('DEL', SOURCE, IMPORTED);
redis('SET', SOURCE, 'backup-payload', 'EX', String(TTL_SECONDS));
const sourceTtl = Number(redis('TTL', SOURCE));
console.log(`fixture: ${SOURCE} TTL=${sourceTtl}s (db${DB})\n`);

// Helpers::export writes {key, ttl(seconds), value(hex DUMP)}.
const payload = [{key: IMPORTED, ttl: sourceTtl, value: dumpHex(SOURCE)}];

const workDir = mkdtempSync(path.join(tmpdir(), 'pca-e2e-'));
const goodFile = path.join(workDir, 'valid-backup.json');
const badFile = path.join(workDir, 'broken.json');
writeFileSync(goodFile, JSON.stringify(payload));
writeFileSync(badFile, 'this is definitely not json {{{');

/**
 * Submit the import form the way a real click does.
 *
 * Two gotchas, both found by this test failing:
 *   - the Import button lives in a modal, so a synthetic click is intercepted by
 *     the page container ("subtree intercepts pointer events");
 *   - form.submit() omits the submit button's own name/value, and the handler is
 *     gated on isset($_POST['submit_import_key']), so the import silently never
 *     ran. Adding the field explicitly reproduces what a click sends.
 */
async function submitImport(page, label) {
    // Watch the actual POST so a failure says what the server answered instead
    // of leaving us to guess.
    const seen = [];
    const onResponse = res => {
        if (res.request().method() === 'POST') {
            seen.push(`${res.status()} ${res.url()}`);
        }
    };

    page.on('response', onResponse);

    await page.evaluate(() => {
        const form = document.querySelector('#import_form');
        const marker = document.createElement('input');

        marker.type = 'hidden';
        marker.name = 'submit_import_key';
        marker.value = '1';
        form.appendChild(marker);

        form.submit();
    });

    await page.waitForTimeout(3000);
    page.off('response', onResponse);

    console.log(`       [${label}] POST responses: ${seen.length ? seen.join('; ') : '(none seen)'}`);
}

let browser;

try {
    console.log('launching browser...');
    browser = await launchBrowser();
    const page = await browser.newPage({viewport: {width: 1500, height: 950}});

    // --- D2: import a key with a TTL -------------------------------------
    await page.goto(keysUrl, {waitUntil: 'networkidle'});
    await page.waitForTimeout(1500);

    await page.setInputFiles('#import', goodFile);
    await submitImport(page, 'valid');

    const importedExists = Number(redis('EXISTS', IMPORTED));
    const importedTtl = Number(redis('TTL', IMPORTED));

    check('imported key exists after a real upload', importedExists === 1, `EXISTS=${importedExists}`);

    if (importedExists === 1) {
        check('imported value round-tripped',
            redis('GET', IMPORTED) === 'backup-payload',
            `value=${redis('GET', IMPORTED)}`);
    }

    // The core D2 assertion.
    check(
        `imported TTL preserved (~${sourceTtl}s, got ${importedTtl}s)`,
        importedTtl > sourceTtl - 60 && importedTtl <= sourceTtl,
        importedTtl < 60
            ? `TTL is ~${Math.round(sourceTtl / 1000)}s, i.e. the 1000x shrink is back`
            : `drift=${sourceTtl - importedTtl}s`
    );

    await page.screenshot({path: `${shotsDir()}/import-e2e-after-valid.png`, fullPage: true});

    // --- D3: a malformed file must say something -------------------------
    await page.goto(keysUrl, {waitUntil: 'networkidle'});
    await page.waitForTimeout(1200);

    const keysBefore = Number(redis('DBSIZE'));

    await page.setInputFiles('#import', badFile);
    await submitImport(page, 'broken');

    const alertState = await page.evaluate(() => {
        const box = document.querySelector('#alerts');
        const body = document.body.innerText.replace(/\s+/g, ' ');

        return {
            exists: !!box,
            html: box ? box.innerHTML.slice(0, 300) : null,
            text: box ? box.innerText.replace(/\s+/g, ' ').trim() : '',
            // The message may be rendered elsewhere (a toast container, a
            // server-side alert block), so search the page text too.
            mentionsJson: /not valid JSON/i.test(body),
            bodySnippet: body.slice(0, 200),
        };
    });

    console.log(`       [broken] alert state: ${JSON.stringify(alertState)}`);

    check('malformed upload shows a message',
        /not valid JSON/i.test(alertState.text) || alertState.mentionsJson,
        `alerts="${alertState.text}"`);
    check('malformed upload changed nothing',
        Number(redis('DBSIZE')) === keysBefore,
        `DBSIZE ${keysBefore} -> ${redis('DBSIZE')}`);

    await page.screenshot({path: `${shotsDir()}/import-e2e-after-broken.png`, fullPage: true});
} catch (error) {
    console.error(`check-redis-import-e2e: ${error.message}`);
    failures.push(`exception: ${error.message}`);
} finally {
    if (browser) {
        await browser.close();
    }
    redis('DEL', SOURCE, IMPORTED);
}

if (failures.length > 0) {
    console.error(`\ncheck-redis-import-e2e: ${failures.length} failed`);
    process.exit(1);
}

console.log('\ncheck-redis-import-e2e: PASS (real upload path preserves TTL and reports bad files)');
