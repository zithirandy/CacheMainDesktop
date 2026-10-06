/**
 * Close-out audit: is every claimed fix actually present in the built app?
 *
 * Ten rounds of changes were verified at the time they were made, but the
 * packaged build was rebuilt several times since (new entry point, opcache
 * wiring, long-path handling). A fix that exists in the working tree but never
 * made it into dist/ is worse than an open bug, because the report says it is
 * done. This checks the shipped artifact directly, plus the repo-level items
 * that are easy to lose in a rebuild.
 *
 *   node scripts/audit-fixes.mjs
 */

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist', 'win-unpacked');
const WEBAPP = path.join(DIST, 'resources', 'webapp');
const PHP_DIR = path.join(DIST, 'resources', 'php');

const rows = [];

/**
 * @param {string} id short fix identifier from the report
 * @param {string} where human-readable location
 * @param {() => boolean} present
 */
function audit(id, where, present) {
    let ok = false;
    let note = '';

    try {
        ok = present() === true;
    } catch (error) {
        note = error.message.slice(0, 60);
    }

    rows.push({id, where, ok, note});
}

const read = file => readFileSync(file, 'utf8');
const fileExists = file => existsSync(file);

// --- Shipped artifact -------------------------------------------------------

audit('P1/P6 opcache args', 'lib/backend.js in asar', () => {
    const asar = path.join(DIST, 'resources', 'app.asar');

    return readFileSync(asar, 'latin1').includes('opcache.file_cache');
});

audit('P6 os ini has abs file_cache', 'resources/php/php.ini',
    () => /^opcache\.file_cache="[A-Za-z]:\\/m.test(read(path.join(PHP_DIR, 'php.ini'))));

audit('P1 os ini has fallback', 'resources/php/php.ini',
    () => read(path.join(PHP_DIR, 'php.ini')).includes('opcache.file_cache_fallback=1'));

audit('P7 long-path guard', 'lib/backend.js in asar', () => {
    const asar = path.join(DIST, 'resources', 'app.asar');

    return readFileSync(asar, 'latin1').includes('realpathSync');
});

audit('P8 bootstrap entry', 'resources/app.asar',
    () => readFileSync(path.join(DIST, 'resources', 'app.asar'), 'latin1').includes('bootstrap.cjs'));

audit('P4 break-all', 'templates/partials/view_key.twig',
    () => read(path.join(WEBAPP, 'templates', 'partials', 'view_key.twig')).includes('break-all'));

audit('P4 max-h-96', 'templates/partials/view_key.twig',
    () => read(path.join(WEBAPP, 'templates', 'partials', 'view_key.twig')).includes('max-h-96'));

audit('D2 ttl*1000', 'src/Dashboards/Redis/RedisTrait.php',
    () => read(path.join(WEBAPP, 'src', 'Dashboards', 'Redis', 'RedisTrait.php')).includes('$ttl * 1000'));

audit('D3 takeImportResult', 'src/Helpers.php',
    () => read(path.join(WEBAPP, 'src', 'Helpers.php')).includes('takeImportResult'));

audit('D3 array_is_list', 'src/Helpers.php',
    () => read(path.join(WEBAPP, 'src', 'Helpers.php')).includes('array_is_list'));

audit('D4 normaliseExpiry', 'src/Dashboards/Memcached/PHPMem.php',
    () => read(path.join(WEBAPP, 'src', 'Dashboards', 'Memcached', 'PHPMem.php')).includes('normaliseExpiry'));

audit('D4 ttl sentinel', 'src/Dashboards/Memcached/MemcachedKeyView.php',
    () => read(path.join(WEBAPP, 'src', 'Dashboards', 'Memcached', 'MemcachedKeyView.php')).includes("'absent'"));

audit('D1 step=any', 'templates/dashboards/redis/form.twig',
    () => read(path.join(WEBAPP, 'templates', 'dashboards', 'redis', 'form.twig')).includes('step='));

audit('O6 expire help', 'templates/partials/form.twig',
    () => read(path.join(WEBAPP, 'templates', 'partials', 'form.twig')).includes('never expires'));

audit('php.exe shipped', 'resources/php/php.exe', () => fileExists(path.join(PHP_DIR, 'php.exe')));

audit('webapp shipped', 'resources/webapp', () => readdirSync(WEBAPP).length > 5);

// --- Repo-level items a rebuild can silently drop ---------------------------

audit('P8 main entry point', 'package.json', () => {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));

    return pkg.main === 'bootstrap.cjs';
});

audit('P8 bootstrap listed (yml)', 'electron-builder.yml',
    () => read(path.join(ROOT, 'electron-builder.yml')).includes('bootstrap.cjs'));

audit('P8 bootstrap listed (offline)', 'scripts/electron-builder.offline.mjs',
    () => read(path.join(ROOT, 'scripts', 'electron-builder.offline.mjs')).includes('bootstrap.cjs'));

audit('P1 template abs path', 'scripts/fetch-php.mjs', () => {
    const src = read(path.join(ROOT, 'scripts', 'fetch-php.mjs'));

    // Assert the template is a FUNCTION of the target dir and emits an absolute
    // path, and that it is actually called with the real constant. Matching the
    // doc comment's `phpIni(phpDir)` spelling instead would be a false alarm -
    // the call site is `phpIni(PHP_DIR)`.
    return src.includes('const phpIni = phpDir =>')
        && src.includes("path.join(phpDir, 'tmp', 'opcache')")
        && src.includes('phpIni(PHP_DIR)');
});

audit('P1 no relative file_cache', 'scripts/fetch-php.mjs',
    () => !read(path.join(ROOT, 'scripts', 'fetch-php.mjs')).includes('file_cache="tmp/opcache"'));

audit('verify entry point', 'package.json',
    () => JSON.parse(read(path.join(ROOT, 'package.json'))).scripts?.verify !== undefined);

// --- The packaged app must actually boot and serve --------------------------

audit('packaged PHP starts', 'spawn resources/php/php.exe', () => {
    const out = execFileSync(path.join(PHP_DIR, 'php.exe'), ['-v'], {encoding: 'utf8'});

    return out.startsWith('PHP ');
});

console.log('close-out audit: are the claimed fixes actually shipped?\n');

let failed = 0;

for (const row of rows) {
    if (!row.ok) {
        failed++;
    }

    console.log(`${row.ok ? ' ok ' : 'MISS'}  ${row.id.padEnd(26)} ${row.where}${row.note ? `  (${row.note})` : ''}`);
}

console.log(`\n${rows.length - failed}/${rows.length} present in the built app`);

if (failed > 0) {
    console.error(`\naudit-fixes: ${failed} claimed fix(es) are NOT in the built artifact`);
    process.exit(1);
}

console.log('audit-fixes: every claimed fix is present in the shipped build');
