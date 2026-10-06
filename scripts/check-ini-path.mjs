/**
 * One-off verification for the GBK php.ini path fix: the Server dashboard
 * HTML must contain the real UTF-8 "原" character in the php.ini path line
 * (raw GBK bytes or U+FFFD artifacts mean the fix did not apply).
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Nothing here is expected to throw, so an uncaught error means the check could
// not run (the backend failed to start, say). Reporting that as success is how
// this script used to pass while the bundled PHP was completely broken - fail
// loudly instead.
process.on('uncaughtException', error => {
    console.error('check-ini-path: could not complete:', error?.message ?? error);
    process.exit(1);
});

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp')},
    logger: () => {},
});

const url = await backend.start();
const html = await fetch(`${url}/?dashboard=server`).then(r => r.text());

// The value cell after the "Loaded php.ini file" label must contain the
// install path with proper UTF-8 characters (原E盘), not raw GBK bytes.
const row = html.match(/data-value="loaded_php_ini_file">([^<]*)</);
const value = row ? row[1] : '';

console.log('VALUE:', value);

const ok = value.includes('原E盘\\CacheMainDesktop\\php\\php.ini');
console.log('FIXED:', ok);

await backend.stop();
process.exit(ok ? 0 : 1);
