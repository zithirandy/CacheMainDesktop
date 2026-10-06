/**
 * Copy the fork's PHP/templates into the packaged app, so a code change can be
 * verified against dist/win-unpacked without a full `npm run dist`.
 *
 * Why this exists: the packaged app serves webapp/ from
 * dist/win-unpacked/resources/webapp, which is a COPY made at build time - not
 * a link. Editing the repo's webapp/ therefore has no effect on the running
 * packaged app, and the difference is easy to miss because the markup still
 * comes from "webapp/".
 *
 *   node scripts/sync-webapp-to-dist.mjs [--dry]
 *
 * Only the files that actually differ are copied. Run `npm run dist` for a real
 * release; this is a development convenience.
 */

import {copyFileSync, existsSync, readFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'webapp');
const DEST = path.join(ROOT, 'dist', 'win-unpacked', 'resources', 'webapp');
const dry = process.argv.includes('--dry');

if (!existsSync(DEST)) {
    console.error(`sync-webapp-to-dist: ${DEST} does not exist - run "npm run dist" first.`);
    process.exit(1);
}

// Everything the fork actually serves. `tmp/` is runtime data, not source.
const dirs = ['src', 'templates', 'assets'];
const files = ['index.php', 'config.php', 'config.dist.php', 'predis.phar'];

const {readdirSync, statSync} = await import('node:fs');

function walk(dir) {
    const out = [];

    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            out.push(...walk(full));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }

    return out;
}

let copied = 0;
let skipped = 0;

const handle = (relative) => {
    const from = path.join(SRC, relative);
    const to = path.join(DEST, relative);

    if (!existsSync(from)) {
        return;
    }

    const same = existsSync(to)
        && statSync(from).size === statSync(to).size
        && readFileSync(from).equals(readFileSync(to));

    if (same) {
        skipped++;
        return;
    }

    console.log(`  ${dry ? 'would update' : 'updated'}  ${relative}`);
    copied++;

    if (!dry) {
        mkdirSync(path.dirname(to), {recursive: true});
        copyFileSync(from, to);
    }
};

for (const dir of dirs) {
    const full = path.join(SRC, dir);

    if (!existsSync(full)) {
        continue;
    }

    for (const file of walk(full)) {
        handle(path.relative(SRC, file));
    }
}

for (const file of files) {
    handle(file);
}

console.log(`sync-webapp-to-dist: ${copied} ${dry ? 'to update' : 'updated'}, ${skipped} already in sync`);

if (copied > 0 && !dry) {
    console.log('Restart the packaged app for the changes to take effect.');
}
