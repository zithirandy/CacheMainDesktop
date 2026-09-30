/**
 * Colorize acceptance: measure real WCAG contrast of the previously flagged
 * action buttons (light theme), and screenshot the connections window in
 * both themes.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {launchBrowser, TEST_ENV, shotsDir} from './lib/test-env.mjs';

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
        PCA_MEMCACHED_0_HOST: TEST_ENV.mcHost,
        PCA_MEMCACHED_0_NAME: 'Mem_233',
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
    },
    logger: () => {},
});

const url = await backend.start();

const browser = await launchBrowser();
const page = await browser.newPage({viewport: {width: 1280, height: 840}});

await page.goto(`${url}/?dashboard=memcached`);
await page.evaluate(() => localStorage.setItem('theme', 'light'));
await page.reload();
await page.waitForTimeout(600);

const ratios = await page.evaluate(() => {
    // Convert oklch (Tailwind v4's authored format) or rgb() to sRGB triple.
    const toRgb = c => {
        if (c.startsWith('rgb')) {
            return c.match(/\d+/g).map(Number).slice(0, 3);
        }

        const m = c.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);

        if (!m) {
            return [0, 0, 0];
        }

        const L = +m[1]; // oklch L is already 0..1
        const C = +m[2];
        const H = +m[3] * Math.PI / 180;

        const a = C * Math.cos(H);
        const b = C * Math.sin(H);

        const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
        const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
        const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

        const l = l_ ** 3;
        const mm = m_ ** 3;
        const ss = s_ ** 3;

        const r = 4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * ss;
        const g = -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * ss;
        const bb = -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * ss;

        const lin = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;

        return [r, g, bb].map(v => Math.round(Math.min(1, Math.max(0, lin(v))) * 255));
    };

    const lum = c => {
        const [r, g, b] = toRgb(c).map(v => {
            const s = v / 255;

            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });

        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    const ratio = (fg, bg) => {
        const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);

        return (l1 + 0.05) / (l2 + 0.05);
    };

    const pick = selector => {
        const el = document.querySelector(selector);

        if (!el) {
            return null;
        }

        const cs = getComputedStyle(el);
        let node = el;
        let bg = getComputedStyle(node).backgroundColor;

        while (node && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
            node = node.parentElement;
            bg = node ? getComputedStyle(node).backgroundColor : bg;
        }

        return {
            selector,
            bg: getComputedStyle(node).backgroundColor,
            fg: cs.color,
            ratio: Math.round(ratio(cs.color, getComputedStyle(node).backgroundColor) * 100) / 100,
            disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        };
    };

    return [
        pick('#delete_all'),
        pick('#submit_search'),
        pick('a.text-sm.inline-flex.bg-green-700') || pick('[class*="bg-green"]'),
    ].filter(Boolean);
});

console.log('CONTRAST ' + JSON.stringify(ratios));

for (const ratio of ratios) {
    if (!ratio.disabled && ratio.ratio < 4.5) {
        console.error(`FAIL ${ratio.selector} contrast ${ratio.ratio}:1`);
        process.exit(1);
    }
}

console.log('ok   action-button contrast >= 4.5:1');

// Connections window in both themes.
for (const theme of ['dark', 'light']) {
    const page2 = await browser.newPage({viewport: {width: 620, height: 720}});
    await page2.goto('file:///' + path.join(ROOT, 'ui', 'connections.html').replaceAll('\\', '/') + `?theme=${theme}`);
    await page2.evaluate(() => {
        window.pcaDesktop = {
            platform: 'electron',
            openConnections: () => true,
            connections: {list: async () => [{id: 'x', type: 'redis', name: 'Redis_122', host: TEST_ENV.redisHost, port: 6379, database: 0}], save: async () => ({ok: true, errors: [], warning: ''})},
        };
    });
    // The page already initialized without the bridge; re-run its init effects by reloading with the bridge in place.
    await page2.reload();
    await page2.waitForTimeout(300);
    await page2.screenshot({path: shotsDir() + `/connections-${theme}.png`});
    await page2.close();
}

console.log('ok   connections window shots (dark, light)');
await browser.close();
stopping = true;
await backend.stop();
process.exit(0);
