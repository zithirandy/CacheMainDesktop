/**
 * Headless reproduction of the connection-manager save bugs (issue #4).
 *
 * Drives the REAL ui/connections.html in a browser with the Electron bridge
 * mocked out, captures every payload sent to connections.save(), then runs
 * those payloads through the real main-process logic (validate/normalize).
 *
 *   node scripts/repro-save.mjs
 */

import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {normalizeConnection, validateConnection} from '../lib/connections.js';
import {TEST_ENV} from './lib/test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'scripts', 'repro-save-capture.json');

const payloads = [];

async function main() {
    const {launchBrowser} = await import('./lib/test-env.mjs');

    const browser = await launchBrowser();
    const page = await browser.newPage();

    await page.addInitScript(() => {
        window.__saveCalls = [];
        window.__events = [];

        for (const type of ['click', 'submit', 'input', 'change']) {
            document.addEventListener(type, event => {
                window.__events.push(`${type}@${event.timeStamp.toFixed(0)}ms target=${event.target.id || event.target.name || event.target.tagName}${event.target.closest?.('form')?.id ? ' form#' + event.target.closest('form').id : ''}`);
            }, true);
        }


        window.pcaDesktop = {
            platform: 'electron',
            openConnections: () => true,
            connections: {
                list: async () => [
                    {
                        id: 'existing01', type: 'redis', name: '已有Redis',
                        host: TEST_ENV.redisHost, port: 6379, database: 0, password: TEST_ENV.redisPassword,
                    },
                ],
                save: async list => {
                    window.__saveCalls.push(list);
                    window.__saveStacks = window.__saveStacks || [];
                    window.__saveStacks.push(new Error('save call #' + window.__saveStacks.length).stack
                        .split('\n').slice(2, 9).map(s => s.trim()).join('\n      '));
                    return {ok: true, errors: [], warning: ''};
                },
            },
        };
    });

    await page.goto('file:///' + path.join(ROOT, 'ui', 'connections.html').replaceAll('\\', '/'));

    const snapshot = async label => {
        const state = await page.evaluate(() => ({
            rows: [...document.querySelectorAll('.conn .name')].map(n => n.textContent),
            editorVisible: !document.getElementById('editor').classList.contains('hidden'),
            status: document.getElementById('status').textContent,
            saveCalls: JSON.parse(JSON.stringify(window.__saveCalls)),
            events: window.__events.slice(-8),
        }));
        console.log(`--- ${label}`);
        console.log('    rows:', JSON.stringify(state.rows), 'editor:', state.editorVisible, 'status:', JSON.stringify(state.status));
        console.log('    saveCalls total:', state.saveCalls.length, '| recent events:', JSON.stringify(state.events));
        payloads.push({label, ...state});
        return state;
    };

    const fill = async (name, host, port, type = 'redis') => {
        await page.click('#add');
        if (type !== 'redis') {
            await page.selectOption('#f-type', type);
        }
        await page.fill('#f-name', name);
        await page.fill('#f-host', host);
        if (port !== null) {
            await page.fill('#f-port', String(port));
        }
    };

    // Scenario A: create a memcached connection exactly like a user would.
    await fill('Mem 会话缓存', '192.0.2.233', 11211, 'memcached');
    await snapshot('A1 memcached form filled');
    await page.click('#editor-apply');
    await snapshot('A2 memcached applied');
    await page.click('#save');
    await page.waitForTimeout(300);
    await snapshot('A3 memcached saved');

    // Scenario B: edit the existing redis connection, change only the name.
    await page.click('.conn [data-action="edit"]');
    await snapshot('B1 editor opened on existing');
    await page.fill('#f-name', '已有Redis改名');
    await snapshot('B2 name changed');
    await page.click('#editor-apply');
    await snapshot('B3 applied');
    await page.click('#save');
    await page.waitForTimeout(300);
    await snapshot('B4 saved');

    // Scenario C: edit again, only change host, apply, save.
    await page.click('.conn [data-action="edit"]');
    await page.fill('#f-host', '192.0.2.219');
    await page.click('#editor-apply');
    await page.click('#save');
    await page.waitForTimeout(300);
    await snapshot('C1 host edited + saved');

    await browser.close();

    // Now push every captured save payload through the real main-process path.
    console.log('=== main-process validation of captured payloads ===');

    let failed = false;
    let call = 0;

    for (const payload of payloads) {
        for (const list of payload.saveCalls) {
            call++;

            for (const raw of list) {
                const {ok, errors} = validateConnection(raw);
                console.log(`call ${call} (${payload.label}): ${raw.type} "${raw.name}" -> ${ok ? 'OK' : 'REJECT: ' + errors.join(' | ')}`);
                failed ||= !ok;
            }
        }
    }

    await writeFile(OUT, JSON.stringify(payloads, null, 2), 'utf8');
    console.log(`capture written: ${path.relative(ROOT, OUT)}`);

    process.exit(failed ? 1 : 0);
}

main().catch(error => {
    console.error(error.message);
    process.exit(1);
});
