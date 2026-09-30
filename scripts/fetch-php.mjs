#!/usr/bin/env node
/**
 * Download and unpack the portable PHP runtime into ./php.
 *
 * Usage:
 *   node scripts/fetch-php.mjs                 # pinned version below
 *   node scripts/fetch-php.mjs 8.3.35          # specific 8.x version
 *
 * Integrity: the sha256 from windows.php.net releases.json is verified
 * before the zip is extracted. Extraction uses the Windows built-in
 * bsdtar (System32/tar.exe), which understands zip archives.
 */

import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PHP_DIR = path.join(ROOT, 'php');

const PINNED_VERSION = '8.5.11';
const version = process.argv[2] ?? PINNED_VERSION;
// releases.json is keyed by major.minor, the exact patch lives in entry.version.
const series = version.split('.').slice(0, 2).join('.');

const RELEASES_URL = 'https://windows.php.net/downloads/releases/releases.json';
const RELEASES_BASE = 'https://windows.php.net/downloads/releases/';

const PHP_INI = `; CacheMainDesktop portable PHP configuration
[PHP]
extension_dir="ext"
extension=mbstring
extension=openssl
extension=pdo_sqlite
zend_extension=php_opcache.dll
opcache.enable=1
opcache.enable_cli=0
opcache.memory_consumption=128
opcache.max_accelerated_files=4000
expose_php=Off
memory_limit=256M
max_execution_time=120
error_log=stderr
log_errors=On
display_errors=Off
date.timezone=UTC
`;

function fail(message) {
    console.error(`fetch-php: ${message}`);
    process.exit(1);
}

async function download(url, target) {
    const response = await fetch(url, {redirect: 'follow'});
    if (!response.ok) {
        fail(`HTTP ${response.status} for ${url}`);
    }

    await pipeline(response.body, createWriteStream(target));
}

async function main() {
    console.log(`fetch-php: resolving PHP ${version} build...`);
    const releases = await (await fetch(RELEASES_URL, {redirect: 'follow'})).json();

    const entry = releases[series];
    if (!entry) {
        fail(`series ${series} not found in releases.json`);
    }

    // Strict pin: releases.json only carries the newest patch of a series, so
    // a mismatch means the pinned build would silently be replaced by a
    // different patch version. Fail the build instead - bump PINNED_VERSION
    // deliberately, or pass --allow-drift to accept the current one.
    if (entry.version !== version && !process.argv.includes('--allow-drift')) {
        fail(`PHP ${version} is no longer the latest of the ${series} series (now ${entry.version}). ` +
            `Update PINNED_VERSION in this script for a deliberate upgrade, or re-run with --allow-drift.`);
    }

    const buildKey = Object.keys(entry).find(key => key.startsWith('nts-') && key.endsWith('x64'));
    if (!buildKey) {
        fail(`no NTS x64 build for PHP ${version}`);
    }

    const zip = entry[buildKey].zip;
    const expectedSha = zip.sha256.toLowerCase();
    const zipPath = path.join(ROOT, `php-${version}.zip`);

    console.log(`fetch-php: downloading ${zip.path} (${zip.size})...`);
    await download(RELEASES_BASE + zip.path, zipPath);

    const actualSha = createHash('sha256')
        .update(await (await import('node:fs/promises')).readFile(zipPath))
        .digest('hex');

    if (actualSha !== expectedSha) {
        await rm(zipPath, {force: true});
        fail(`sha256 mismatch (expected ${expectedSha}, got ${actualSha})`);
    }
    console.log('fetch-php: sha256 verified.');

    console.log('fetch-php: extracting...');
    await rm(PHP_DIR, {recursive: true, force: true});
    await mkdir(PHP_DIR, {recursive: true});

    // Windows ships bsdtar, which transparently extracts zip archives.
    execFileSync(`${process.env.SystemRoot}\\System32\\tar.exe`, ['-xf', zipPath, '-C', PHP_DIR], {stdio: 'inherit'});

    await rm(zipPath, {force: true});

    console.log('fetch-php: writing php.ini...');
    await writeFile(path.join(PHP_DIR, 'php.ini'), PHP_INI);

    const exe = path.join(PHP_DIR, 'php.exe');
    const exeStat = await stat(exe).catch(() => null);
    if (!exeStat) {
        fail('php.exe not found after extraction');
    }

    console.log(`fetch-php: done -> ${path.relative(ROOT, exe)}`);
    console.log('fetch-php: verify with: php/php.exe -v');
}

main().catch(error => fail(error.message));
