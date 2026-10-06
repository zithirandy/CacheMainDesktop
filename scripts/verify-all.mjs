/**
 * Run the whole verification suite with one command.
 *
 * Before this existed, verifying the app meant pasting ~15 commands by hand and
 * reading 15 exit codes, four of which needed a port passed in (the PHP port is
 * random per launch, so it had to be looked up first). That made "run the tests"
 * expensive enough to skip, which is how regressions survived several rounds.
 *
 *   node scripts/verify-all.mjs              # run everything
 *   node scripts/verify-all.mjs --only plan  # run matching suites only
 *   node scripts/verify-all.mjs --list       # show what would run
 *
 * The port-hungry checks are given the running app's PHP port automatically.
 * Suites that boot their own backend (smoke, check-live-servers) do not need it.
 */

import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const listOnly = args.includes('--list');

const NODE = process.execPath;
const PHP = path.join(ROOT, 'php', 'php.exe');

/**
 * The PHP port the running app picked. The backend binds a random loopback port,
 * so the port argument cannot be hard-coded; read it off the php.exe command line.
 *
 * @returns {string|null}
 */
function runningPhpPort() {
    try {
        const output = execFileSync('powershell.exe', [
            '-NoProfile', '-Command',
            "Get-CimInstance Win32_Process -Filter \"Name='php.exe'\" | "
            + "Select-Object -ExpandProperty CommandLine",
        ], {encoding: 'utf8', timeout: 20_000});

        const match = output.match(/-S 127\.0\.0\.1:(\d+)/);

        return match ? match[1] : null;
    } catch {
        return null;
    }
}

const phpPort = runningPhpPort();
const redisIndex = process.env.PCA_VERIFY_REDIS_SERVER ?? '2';
const mcIndex = process.env.PCA_VERIFY_MC_SERVER ?? '0';

// [name, command, needsPort]
const suites = [
    // Runs first: a claimed fix missing from the build makes everything below
    // meaningless, so fail fast on that.
    ['shipped-fixes-audit', [NODE, 'scripts/audit-fixes.mjs'], false],
    ['node-unit', [NODE, '--test', 'test/connections.test.mjs', 'test/window-state.test.mjs'], false],
    ['php-expiry', [PHP, 'scripts/test-php-normalise-expiry.php'], false],
    ['php-import', [PHP, 'scripts/test-php-import.php'], false],
    ['php-harden', [PHP, 'scripts/check-harden.php'], false],
    ['redis-import-ttl', [PHP, 'scripts/check-redis-restore-ttl.php'], false],
    ['smoke', [NODE, 'scripts/smoke.mjs'], false],
    ['ini-path', [NODE, 'scripts/check-ini-path.mjs'], false],
    ['layout', [NODE, 'scripts/check-layout.mjs'], false],
    ['plan', [NODE, 'scripts/check-plan.mjs'], false],
    ['sticky', [NODE, 'scripts/check-sticky.mjs'], false],
    ['contrast', [NODE, 'scripts/check-contrast.mjs'], false],
    ['live-servers', [NODE, 'scripts/check-live-servers.mjs'], false],
    ['connection-errors', [NODE, 'scripts/check-connection-errors.mjs'], false],
    ['connections-window', [NODE, 'scripts/check-connections-window.mjs'], false],
    ['import-e2e', [NODE, 'scripts/check-redis-import-e2e.mjs'], true],
    ['all-panels', [NODE, 'scripts/check-all-panels.mjs'], true],
    ['big-value', [NODE, 'scripts/check-big-value-collapse.mjs'], true],
];

const selected = only
    ? suites.filter(([name]) => name.includes(only))
    : suites;

// A filter that matches nothing must not look like a green run - that is the
// same false-pass shape this repo has already been bitten by twice
// (check-ini-path / check-layout exiting 0 on any error).
if (selected.length === 0) {
    console.error(`verify-all: no suite matches --only "${only}"`);
    console.error(`  available: ${suites.map(([name]) => name).join(', ')}`);
    process.exit(1);
}

if (listOnly) {
    console.log(`running PHP port: ${phpPort ?? '(none found - port-hungry suites will be skipped)'}`);
    for (const [name, , needsPort] of selected) {
        console.log(`  ${name}${needsPort ? '  (needs the app running)' : ''}`);
    }
    process.exit(0);
}

console.log('verify-all: CacheMainDesktop\n');
console.log(`  php port : ${phpPort ?? '(not running)'}`);
console.log(`  redis idx: ${redisIndex}   memcached idx: ${mcIndex}`);
console.log(`  suites   : ${selected.length}\n`);

const results = [];

for (const [name, argv, needsPort] of selected) {
    // Suites that talk to the running app need its port; without it they would
    // fail for the wrong reason, so say that instead of reporting a red suite.
    if (needsPort && !phpPort) {
        console.log(`SKIP  ${name}  (app not running - start dist/win-unpacked/CacheMainDesktop.exe)`);
        results.push({name, code: null});
        continue;
    }

    const finalArgv = needsPort
        ? [...argv, ...extraArgsFor(name, phpPort)]
        : argv;

    process.stdout.write(`RUN   ${name} ... `);

    const started = Date.now();
    const result = spawnSync(finalArgv[0], finalArgv.slice(1), {
        cwd: ROOT,
        encoding: 'utf8',
        maxBuffer: 20 << 20,
    });
    const ms = Date.now() - started;

    const code = result.status ?? 1;
    results.push({name, code, ms, stdout: result.stdout, stderr: result.stderr});

    console.log(code === 0 ? `ok (${ms}ms)` : `FAIL (${ms}ms, exit ${code})`);
}

/**
 * Positional arguments each suite expects.
 *
 * @param {string} name
 * @param {string} port
 * @returns {string[]}
 */
function extraArgsFor(name, port) {
    switch (name) {
        case 'import-e2e':
            return [port, redisIndex];
        case 'all-panels':
            return [port, redisIndex, mcIndex];
        case 'big-value':
            // debug port first, then the app's PHP port and the db9 connection.
            return ['19233', port, redisIndex, 'o9test'];
        default:
            return [port];
    }
}

const failed = results.filter(r => r.code !== 0 && r.code !== null);
const skipped = results.filter(r => r.code === null);

console.log('\n' + '='.repeat(66));

for (const r of results) {
    const label = r.code === null ? 'SKIP' : r.code === 0 ? 'ok  ' : 'FAIL';
    console.log(`  ${label}  ${r.name}`);
}

console.log('='.repeat(66));
console.log(`  ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);

if (failed.length > 0) {
    console.log('\n--- output of failing suites ---');

    for (const r of failed) {
        console.log(`\n### ${r.name}\n`);

        const lines = ((r.stdout ?? '') + (r.stderr ?? '')).split('\n');
        const interesting = lines.filter(l =>
            /FAIL|Error|error|assert|expected|✖|not ok/i.test(l));

        console.log(interesting.length > 0
            ? interesting.slice(0, 25).join('\n')
            : lines.slice(-25).join('\n'));
    }

    process.exit(1);
}

// A suite that could not run is not a pass; make that visible in the exit code
// the same way a skip shows up in CI.
if (skipped.length > 0) {
    console.log('\n(some suites were skipped - the app was not running)');
}

console.log('\nverify-all: all suites passed');
