/**
 * Shared helpers for the browser-driven check scripts.
 *
 * - Creds come from the environment (never from the repo):
 *     PCA_TEST_REDIS_HOST / PCA_TEST_REDIS_PASSWORD / PCA_TEST_REDIS_PORT
 *     PCA_TEST_MC_HOST / PCA_TEST_MC_PORT
 *   hasTestCreds() lets a script degrade to its local-only checks instead of
 *   faking a green run when they are absent.
 * - launchBrowser() resolves a chromium executable via PCA_TEST_BROWSER,
 *   the ms-playwright cache, or Playwright's channel fallback.
 */

import {readdirSync, existsSync} from 'node:fs';
import path from 'node:path';

export const TEST_ENV = {
    redisHost: process.env.PCA_TEST_REDIS_HOST ?? '192.0.2.122',
    redisPassword: process.env.PCA_TEST_REDIS_PASSWORD ?? '',
    redisPort: process.env.PCA_TEST_REDIS_PORT ?? '6379',
    mcHost: process.env.PCA_TEST_MC_HOST ?? '192.0.2.233',
    mcPort: process.env.PCA_TEST_MC_PORT ?? '11211',
};

export function hasTestCreds() {
    return TEST_ENV.redisPassword !== '';
}

/**
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchBrowser() {
    const {chromium} = await import('playwright-core');

    const candidates = [];

    if (process.env.PCA_TEST_BROWSER) {
        candidates.push(process.env.PCA_TEST_BROWSER);
    }

    const cacheDir = path.join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');

    if (existsSync(cacheDir)) {
        for (const entry of readdirSync(cacheDir)) {
            if (entry.startsWith('chromium-')) {
                candidates.push(path.join(cacheDir, entry, 'chrome-win64', 'chrome.exe'));
                candidates.push(path.join(cacheDir, entry, 'chrome-win', 'chrome.exe'));
            }
        }
    }

    for (const executablePath of candidates) {
        if (existsSync(executablePath)) {
            return chromium.launch({executablePath});
        }
    }

    // Fall back to whatever Playwright can find on its own.
    return chromium.launch();
}
