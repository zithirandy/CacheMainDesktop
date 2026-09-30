/**
 * File logger with daily rotation.
 *
 * Writes `<dir>/main-YYYY-MM-DD.log`, keeps the newest `keep` files, echoes
 * everything to stdout as well (useful under `npm start`). Log writes must
 * never take the application down, so every failure is swallowed.
 */

import {appendFile, mkdir, readdir, unlink} from 'node:fs/promises';
import path from 'node:path';

const LOG_FILE_PATTERN = /^main-\d{4}-\d{2}-\d{2}\.log$/;

const TAGS = {
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
};

/**
 * @param {string} dir absolute log directory
 * @param {{echo?: boolean, keep?: number}} options
 * @returns {{debug: (...any) => void, info: (...any) => void, warn: (...any) => void, error: (...any) => void}}
 */
export function createFileLogger(dir, {echo = true, keep = 7} = {}) {
    let currentDate = '';
    let currentFile = '';
    let pruned = false;

    async function prune() {
        try {
            const files = (await readdir(dir))
                .filter(name => LOG_FILE_PATTERN.test(name))
                .sort();

            for (const name of files.slice(0, Math.max(0, files.length - keep))) {
                await unlink(path.join(dir, name));
            }
        } catch {
            // Best effort cleanup.
        }
    }

    async function write(level, args) {
        try {
            const now = new Date();
            const date = now.toISOString().slice(0, 10);

            if (date !== currentDate) {
                currentDate = date;
                currentFile = path.join(dir, `main-${date}.log`);
                await mkdir(dir, {recursive: true});

                if (!pruned) {
                    await prune();
                    pruned = true;
                }
            }

            const line = args
                .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
                .join(' ');

            await appendFile(currentFile, `${now.toISOString().slice(11, 23)} [${TAGS[level]}] ${line}\n`, 'utf8');

            if (echo) {
                console.log(`[${TAGS[level]}] ${line}`);
            }
        } catch {
            // Logging must never crash the app.
        }
    }

    return {
        debug: (...args) => write('debug', args),
        info: (...args) => write('info', args),
        warn: (...args) => write('warn', args),
        error: (...args) => write('error', args),
    };
}
