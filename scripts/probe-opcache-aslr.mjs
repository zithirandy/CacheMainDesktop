/**
 * Measure how often the bundled PHP fails to start, per opcache configuration.
 *
 * The failure is intermittent and depends on where Windows maps the binary:
 *
 *   Fatal Error Opcode handlers are unusable due to ASLR.
 *   Please setup opcache.file_cache and opcache.file_cache_fallback directives
 *
 * A single successful boot therefore proves nothing, which is exactly the
 * mistake made earlier: "3/3 boots" was read as a fix, when the real problem is
 * a rate rather than a yes/no. This runs each candidate many times and reports
 * the success rate, so the config choice is evidence-based.
 *
 *   node scripts/probe-opcache-aslr.mjs [runs] [phpDir]
 */

import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = Number(process.argv[2] ?? 10);
const phpDir = process.argv[3] ?? path.join(ROOT, 'php');

const phpExe = path.join(phpDir, 'php.exe');
const iniPath = path.join(phpDir, 'php.ini');

if (!existsSync(phpExe)) {
    console.error(`no php.exe at ${phpExe}`);
    process.exit(1);
}

const original = readFileSync(iniPath, 'utf8');

const stripOpcache = ini => ini
    .replace(/^opcache\.file_cache=.*$/m, '')
    .replace(/^opcache\.file_cache_fallback=.*$/m, '')
    .replace(/^opcache\.enable=.*$/m, '')
    .replace(/^opcache\.memory_consumption=.*$/m, '')
    .replace(/^opcache\.max_accelerated_files=.*$/m, '');

const absoluteCacheDir = path.join(phpDir, 'tmp', 'opcache');

const candidates = [
    {
        name: 'opcache on, no file_cache (first attempt)',
        apply: ini => stripOpcache(ini)
            + '\nopcache.enable=1\nopcache.memory_consumption=128\nopcache.max_accelerated_files=4000\n',
    },
    {
        name: 'opcache on + file_cache_fallback only',
        apply: ini => stripOpcache(ini) + '\nopcache.enable=1\nopcache.file_cache_fallback=1\n',
    },
    {
        name: 'opcache on + absolute file_cache + fallback',
        apply: ini => stripOpcache(ini)
            + `\nopcache.enable=1\nopcache.file_cache="${absoluteCacheDir}"\nopcache.file_cache_fallback=1\n`,
        prepare: () => mkdirSync(absoluteCacheDir, {recursive: true}),
    },
    {
        name: 'opcache disabled entirely',
        apply: ini => stripOpcache(ini) + '\nopcache.enable=0\n',
    },
];

const bootOnce = async () => {
    const port = 20100 + Math.floor(Math.random() * 400);
    const child = spawn(phpExe, ['-S', `127.0.0.1:${port}`, '-t', path.join(ROOT, 'webapp')], {
        cwd: phpDir,
        stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', chunk => {
        stderr += chunk.toString();
    });

    await new Promise(resolve => setTimeout(resolve, 1200));

    const alive = child.exitCode === null;
    child.kill();

    return {alive, stderr};
};

console.log(`probing ${phpDir}  (${RUNS} boots per configuration)\n`);

for (const candidate of candidates) {
    if (candidate.prepare) {
        candidate.prepare();
    }

    writeFileSync(iniPath, candidate.apply(original));

    let ok = 0;
    let aslr = 0;
    let other = '';

    for (let i = 0; i < RUNS; i++) {
        const {alive, stderr} = await bootOnce();

        if (alive) {
            ok++;
        } else if (/ASLR/i.test(stderr)) {
            aslr++;
        } else {
            other = stderr.split('\n').find(line => line.trim()) ?? '';
        }
    }

    const rate = String(Math.round((ok / RUNS) * 100)).padStart(3);
    console.log(`${String(ok).padStart(2)}/${RUNS} (${rate}%)  aslrFail=${aslr}  ${candidate.name}`);

    if (other) {
        console.log(`             other error: ${other.slice(0, 120)}`);
    }
}

writeFileSync(iniPath, original);
console.log('\nphp.ini restored to its original contents');
