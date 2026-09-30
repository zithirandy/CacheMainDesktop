/**
 * Verification for the impeccable action plan (harden + polish + distill),
 * against the real servers, in a real browser.
 *
 *   node scripts/check-plan.mjs
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
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
const check = (name, ok) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
    failures.push(...(ok ? [] : [name]));
};

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        ...toEnvVars([
            {id: 'r1', type: 'redis', name: 'Redis_122', host: '192.0.2.122', port: 6379, database: 0, password: '***REDACTED***'},
            {id: 'm1', type: 'memcached', name: 'Mem_233', host: '192.0.2.233', port: 11211, database: 0},
        ]),
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();

// --- Server-side markers first (no browser needed) ---
const mcPage = await fetch(`${url}/?dashboard=memcached`).then(r => r.text());

check('memcached: no "57 years ago"', !mcPage.includes('57 years ago'));
check('memcached: shows Never for never-accessed keys', mcPage.includes('Never'));
check('memcached: panel says Server version', mcPage.includes('Server version'));
check('memcached: panel separates Client (PHPMem)', mcPage.includes('PHPMem'));
check('memcached: no fake 0.00B sizes', !mcPage.includes('0.00B') && !mcPage.includes('0,00B'));
check('memcached: no "0 max" connections', !mcPage.includes('/ 0 max'));
check('delete-all has a confirm guard', mcPage.includes('Delete ALL keys in this database?'));

const redisPage = await fetch(`${url}/?dashboard=redis`).then(r => r.text());
check('redis: panel says Server version', redisPage.includes('Server version'));
check('thousands separator is a comma (7,197-style)', /,\d{3}\b/.test(redisPage.replace(/PHPMem|Predis/g, '')) || redisPage.includes('7,197'));

// --- Browser checks: frozen headers, tab grouping ---
const {chromium} = await import('playwright-core');
const browser = await chromium.launch({executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe'});
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
const moreItems = await page.evaluate(() => {
    document.querySelector('.tabs-more-toggle').click();

    return [...document.querySelectorAll('.tabs-more-menu a')].map(e => e.textContent.trim());
});
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

await page.screenshot({path: 'docs/shots/plan-memcached-scrolled.png'});
await browser.close();
stopping = true;
await backend.stop();

if (failures.length > 0) {
    console.error(`${failures.length} check(s) failed.`);
    process.exit(1);
}

console.log('all plan checks passed.');
process.exit(0);
