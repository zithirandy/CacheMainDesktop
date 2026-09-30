/**
 * Visual check: sticky tab bar + layout widths, against the real db5 page.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {launchBrowser, TEST_ENV} from './lib/test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let stopping = false;
process.on('uncaughtException', error => {
    if (stopping && error?.code === 'ERR_ASSERTION') {
        return;
    }

    console.error(error);
    process.exit(1);
});

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        PCA_REDIS_0_HOST: TEST_ENV.redisHost,
        PCA_REDIS_0_NAME: 'Prod',
        PCA_REDIS_0_PASSWORD: TEST_ENV.redisPassword,
        PCA_REDIS_0_DATABASE: '5',
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();

const browser = await launchBrowser();
const page = await browser.newPage({viewport: {width: 1280, height: 840}});

await page.goto(`${url}/?dashboard=redis&db=5`);
await page.waitForTimeout(500);

const measure = () => page.evaluate(() => {
    const tabs = document.querySelector('.pca-page > ul.flex');
    const content = document.querySelector('.pca-page');
    const sidebar = document.querySelector('.pca-sidebar');
    const rail = document.querySelector('.pca-rail');
    const rect = el => el ? Math.round(el.getBoundingClientRect().width) : -1;

    return {
        sidebar: rect(sidebar),
        rail: rect(rail),
        content: rect(content),
        tabsTop: tabs ? Math.round(tabs.getBoundingClientRect().top) : -1,
        scrollTop: content ? Math.round(content.scrollTop) : -1,
    };
});

console.log('at top   :', JSON.stringify(await measure()));
await page.screenshot({path: 'docs/shots/sticky-top.png'});

// Scroll the content container halfway down the key list.
await page.evaluate(() => {
    const content = document.querySelector('.pca-page');
    content.scrollTop = Math.floor(content.scrollHeight / 2);
});
await page.waitForTimeout(200);

const scrolled = await measure();
console.log('scrolled :', JSON.stringify(scrolled), '| tabs still visible:', scrolled.tabsTop >= -20 && scrolled.tabsTop < 40);
await page.screenshot({path: 'docs/shots/sticky-scrolled.png'});

await browser.close();
stopping = true;
await backend.stop();
process.exit(scrolled.tabsTop >= -20 && scrolled.tabsTop < 40 ? 0 : 1);
