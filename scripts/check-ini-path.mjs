/**
 * One-off verification for the GBK php.ini path fix: the Server dashboard
 * HTML must contain the real UTF-8 "原" character in the php.ini path line
 * (raw GBK bytes or U+FFFD artifacts mean the fix did not apply).
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

process.on('uncaughtException', () => process.exit(0));

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
