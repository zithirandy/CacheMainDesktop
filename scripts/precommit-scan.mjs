/**
 * Pre-commit safety scan for a PUBLIC repo.
 *
 * CacheMainDesktop's git history was once rewritten to scrub credentials, and a
 * previous round of this session accidentally pulled real LAN key names off a
 * production Memcached. So before a commit this checks the exact files that are
 * about to be committed, not the tree in general.
 *
 *   node scripts/precommit-scan.mjs
 *
 * Exits 1 if anything looks like a real host, credential or production key name.
 */

import {execFileSync} from 'node:child_process';
import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files git reports as changed or untracked. */
function changedFiles() {
    const out = execFileSync('git', ['status', '--porcelain'], {cwd: ROOT, encoding: 'utf8'});

    return out.split('\n')
        .filter(Boolean)
        .map(line => line.slice(3).trim().replace(/^"(.*)"$/, '$1'));
}

/** Everything that would be written by `git add -A`, i.e. what a commit contains. */
function expandedTargets() {
    const targets = [];

    for (const entry of changedFiles()) {
        const full = path.join(ROOT, entry);

        let stat;
        try {
            stat = statSync(full);
        } catch {
            continue;
        }

        if (stat.isFile()) {
            targets.push(entry);
        }
    }

    return targets;
}

// Text formats worth scanning; binaries/screenshots are checked separately.
const TEXT = /\.(mjs|cjs|js|ts|php|py|sh|json|ya?ml|md|twig|css|html|txt|ini|gitignore|gitattributes)$/i;

const RULES = [
    {
        name: 'private LAN / non-loopback host',
        // Loopback is expected in tests; private ranges and other literals are not.
        re: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
        allow: /REDACTED|example\.com|placeholder|192\.168\.x\.x|<host>/i,
    },
    {
        name: 'literal credential',
        re: /\b(?:password|passwd|pwd|secret|token|apikey|api_key)\b\s*[:=]\s*['"`]([^'"`]{4,})['"`]/gi,
        // Values that are clearly test fixtures or read from the environment.
        allow: /PCA_TEST|process\.env|TEST_ENV|\$\{|example|placeholder|changeme|definitely-not|not-the-password|redacted|test/i,
    },
    {
        name: 'production-style cache key name',
        // Deliberately NOT a list of the real key prefixes: naming them here
        // would put them back into a public repo, which is the very thing this
        // rule exists to prevent. The shape is the giveaway - an identifier-ish
        // CamelCase/underscored token long enough to be a business key name
        // (e.g. something like "SomeBusinessEntity_SubKey1234") appearing as a
        // key/value in captured state.
        re: /["'](?:key|keys|name)["']\s*[:=]\s*["']([A-Z][A-Za-z0-9]{3,}(?:_[A-Za-z0-9]{3,}){1,})["']/g,
        allow: /crud:|test|fixture|imported|greeting|counter|leaderboard|queue:|tags:|user:|config:|app:|e2e:|o9test|sample|example/i,
    },
];

const findings = [];
const targets = expandedTargets();

for (const rel of targets) {
    if (!TEXT.test(rel)) {
        continue;
    }

    let content;
    try {
        content = readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
        continue;
    }

    const lines = content.split('\n');

    for (const rule of RULES) {
        lines.forEach((line, index) => {
            if (rule.allow?.test(line)) {
                return;
            }

            rule.re.lastIndex = 0;

            if (rule.re.test(line)) {
                findings.push({
                    file: rel,
                    line: index + 1,
                    rule: rule.name,
                    text: line.trim().slice(0, 110),
                });
            }
        });
    }
}

console.log(`precommit-scan: ${targets.length} file(s) about to be committed\n`);

// Also report what is NOT being committed, so nothing sensitive slips in silently.
const ignored = execFileSync('git', ['status', '--porcelain', '--ignored'], {cwd: ROOT, encoding: 'utf8'})
    .split('\n')
    .filter(l => l.startsWith('!!'))
    .map(l => l.slice(3).trim())
    .filter(Boolean);

console.log(`gitignored (will NOT be committed): ${ignored.slice(0, 12).join(', ')}${ignored.length > 12 ? `, +${ignored.length - 12} more` : ''}\n`);

if (findings.length === 0) {
    console.log('precommit-scan: no hosts, credentials or production key names found');
    process.exit(0);
}

console.error(`precommit-scan: ${findings.length} finding(s) - review before committing\n`);

for (const f of findings) {
    console.error(`  [${f.rule}] ${f.file}:${f.line}`);
    console.error(`      ${f.text}`);
}

process.exit(1);
