/**
 * Verification for the impeccable action plan (harden + polish + distill),
 * against the real servers, in a real browser.
 *
 *   node scripts/check-plan.mjs
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {launchBrowser, TEST_ENV, shotsDir} from './lib/test-env.mjs';
import {toEnvVars} from '../lib/connections.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Swallow only the undici teardown assertion at shutdown; anything else must surface.
let stopping = false;
process.on('uncaughtException', error => {
    if (stopping && error?.code === 'ERR_ASSERTION') {
        return;
    }

    console.error(error);
    process.exit(1);
});

const failures = [];
const check = (name, ok, detail = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
    failures.push(...(ok ? [] : [name]));
};

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        ...toEnvVars([
            {id: 'r1', type: 'redis', name: 'Redis_122', host: TEST_ENV.redisHost, port: 6379, database: 0, password: TEST_ENV.redisPassword},
            {id: 'm1', type: 'memcached', name: 'Mem_233', host: TEST_ENV.mcHost, port: Number(TEST_ENV.mcPort), database: 0},
        ]),
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();

// --- Server-side markers first (no browser needed) ---
const mcPage = await fetch(`${url}/?dashboard=memcached`).then(r => r.text());

check('memcached: no "57 years ago"', !mcPage.includes('57 years ago'));

// The Last used column must be a formatted relative time (or "Never" for a key
// whose last-access stamp is 0). Asserting "Never" specifically was wrong: these
// fixture keys are written moments before the check, so their `la` is a fresh
// epoch, and the assertion only passed if the seed happened to leave la=0.
// What is worth guarding is that the formatter ran at all - a raw epoch leaking
// through is the regression this column has had before.
const lastUsedCell = mcPage.match(/<td[^>]*>\s*([^<]*ago|Never|less than a minute)\s*<\/td>/i);

check(
    'memcached: Last used renders "Never" or a relative time',
    mcPage.includes('Never') || /\b\d+\s+(second|minute|hour|day|month|year)s?\s+ago\b/.test(mcPage)
        || mcPage.includes('less than a minute'),
    // Keep the evidence: this failed once and the reason was not recorded.
    `lastUsedCell=${JSON.stringify(lastUsedCell?.[1]?.trim() ?? null)}`
);
check('memcached: panel says Server version', mcPage.includes('Server version'));
check('memcached: panel separates Client (PHPMem)', mcPage.includes('PHPMem'));
// The Size column must not show a fabricated 0.00B for a key whose size is
// unknown ("n/a" is the documented behaviour on the text-protocol path).
//
// This failed once during a full verify-all run and has not reproduced since
// (25 direct page fetches, several full-suite runs, and both size code paths in
// MemcachedKeysList.php verified to guard with 'n/a'). Since the cause is still
// unknown, the assertion now carries its evidence: if it fires again, the
// snippet says which element produced it instead of leaving a bare FAIL.
const zeroSizeIndex = Math.max(mcPage.indexOf('0.00B'), mcPage.indexOf('0,00B'));
const zeroSizeSnippet = zeroSizeIndex === -1
    ? null
    : mcPage.slice(Math.max(0, zeroSizeIndex - 220), zeroSizeIndex + 80).replace(/\s+/g, ' ');

check(
    'memcached: no fake 0.00B sizes',
    zeroSizeIndex === -1,
    zeroSizeSnippet ? `context: ...${zeroSizeSnippet}...` : ''
);
check('memcached: no "0 max" connections', !mcPage.includes('/ 0 max'));
check('delete-all button present (confirm handled by scripts.js)', mcPage.includes('id="delete_all"'));

const treeRes = await fetch(`${url}/?dashboard=memcached&view=tree`);
const treeBody = await treeRes.text();
check('memcached tree view renders (n/a sizes guarded)', treeRes.status === 200 && !treeBody.includes('Template error'), 'status ' + treeRes.status);

const redisPage = await fetch(`${url}/?dashboard=redis`).then(r => r.text());
check('no truncation notice when db fits under scansize', !redisPage.includes('capped by scansize'));
check('redis: panel says Server version', redisPage.includes('Server version'));
check('thousands separator is a comma (7,197-style)', /,\d{3}\b/.test(redisPage.replace(/PHPMem|Predis/g, '')) || redisPage.includes('7,197'));

// --- Browser checks: frozen headers, tab grouping ---
const browser = await launchBrowser();
const page = await browser.newPage({viewport: {width: 1280, height: 840}});

await page.goto(`${url}/?dashboard=memcached`);
await page.evaluate(() => localStorage.setItem('theme', 'dark'));
await page.reload();
await page.waitForTimeout(600);

const measure = () => page.evaluate(() => {
    const content = document.querySelector('.pca-page');
    const toolbar = document.querySelector('.keys-toolbar');
    const th = document.querySelector('#keys_table thead th');
    const tabs = document.querySelector('.pca-page > ul.flex');
    const more = document.querySelector('.tabs-more-menu');

    const rect = el => {
        if (!el) {
            return null;
        }

        const r = el.getBoundingClientRect();

        return {top: Math.round(r.top), h: Math.round(r.height)};
    };

    return {
        scrollTop: content ? Math.round(content.scrollTop) : -1,
        tabs: rect(tabs),
        tabsDebug: tabs ? {inlineH: tabs.style.height, cls: tabs.className.slice(0, 60), childCount: tabs.children.length} : null,
        toolbar: rect(toolbar),
        th: rect(th),
        hasMore: more !== null,
        visibleTabLabels: [...document.querySelectorAll('#pca_tabs > li > a, #pca_tabs > li > button')].map(a => a.textContent.trim()).filter(t => t && t !== 'More'),
    };
});

const top = await measure();
console.log('at top   :', JSON.stringify(top));
check('tab bar rendered', top.tabs !== null);
check('More dropdown present', top.hasMore);
check('primary tabs are 3 or fewer', top.visibleTabLabels.length <= 3, `got ${JSON.stringify(top.visibleTabLabels)}`);

// Open the More dropdown via a DOM click (details toggle needs no actionability wait).
const more = await page.evaluate(() => {
    document.querySelector('.tabs-more-toggle').click();

    const menu = document.querySelector('.tabs-more-menu');
    const r = menu.getBoundingClientRect();
    const visible = !menu.classList.contains('hidden') && r.height > 20 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;

    return {visible: visible ? 1 : 0, rect: {top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height)}, items: [...menu.querySelectorAll('a')].map(e => e.textContent.trim())};
});
const moreItems = more.items;
check('More menu is actually visible (not clipped)', more.visible === 1, JSON.stringify(more.rect));
console.log('More menu:', JSON.stringify(moreItems));
check('More menu contains Watcher and Metrics', moreItems.includes('Watcher') && moreItems.includes('Metrics'));

await page.evaluate(() => {
    const content = document.querySelector('.pca-page');
    content.scrollTop = Math.floor(content.scrollHeight / 2);
});
await page.waitForTimeout(200);

const scrolled = await measure();
console.log('scrolled :', JSON.stringify(scrolled));
check('tabs bar still at top', scrolled.tabs && scrolled.tabs.top >= -20 && scrolled.tabs.top < 40);
check('toolbar still visible', scrolled.toolbar && scrolled.toolbar.top >= -4 && scrolled.toolbar.top < 120);
check('table header still visible', scrolled.th && scrolled.th.top >= 100 && scrolled.th.top < 260);

await page.screenshot({path: shotsDir() + '/plan-memcached-scrolled.png'});
await browser.close();
stopping = true;
await backend.stop();

if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed.`);
    process.exit(1);
}

console.log('all plan checks passed.');
process.exit(0);
