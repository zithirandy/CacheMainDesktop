/**
 * Smoke every dashboard tab and sub-page for HTTP success and clean PHP output.
 *
 * During verification of the CRUD fixes, each panel was probed by hand and all
 * came back 200 with no PHP diagnostics. That sweep was not reproducible, so a
 * regression on any of these surfaces (a broken template, a PHP notice from a
 * strict-types mismatch) would go unnoticed until someone happened to open the
 * tab.
 *
 * All tabs are requested against the LOCAL test servers by default, and the
 * server index is explicit - never the panel default, which can point at a real
 * remote database. See docs/本地测试服务-连接信息.md.
 *
 *   node scripts/check-all-panels.mjs [phpPort] [redisServerIndex] [mcServerIndex]
 */

const phpPort = process.argv[2] ?? process.env.PCA_PANEL_PORT ?? '55162';
const redisIndex = process.argv[3] ?? '2';
const mcIndex = process.argv[4] ?? '0';

const BASE = `http://127.0.0.1:${phpPort}`;

const paths = [
    ['server', '/?dashboard=server'],
    ['redis keys', `/?dashboard=redis&server=${redisIndex}`],
    ['redis tree', `/?dashboard=redis&server=${redisIndex}&view=tree`],
    ['redis analysis', `/?dashboard=redis&server=${redisIndex}&tab=analysis`],
    ['redis console', `/?dashboard=redis&server=${redisIndex}&tab=console`],
    ['redis slowlog', `/?dashboard=redis&server=${redisIndex}&tab=slowlog`],
    ['redis metrics', `/?dashboard=redis&server=${redisIndex}&tab=metrics`],
    ['redis clients', `/?dashboard=redis&server=${redisIndex}&tab=clients`],
    ['redis pubsub', `/?dashboard=redis&server=${redisIndex}&tab=pubsub`],
    ['redis new-key form', `/?dashboard=redis&server=${redisIndex}&form=new`],
    ['memcached keys', `/?dashboard=memcached&server=${mcIndex}`],
    ['memcached tree', `/?dashboard=memcached&server=${mcIndex}&view=tree`],
    ['memcached analysis', `/?dashboard=memcached&server=${mcIndex}&tab=analysis`],
    ['memcached console', `/?dashboard=memcached&server=${mcIndex}&tab=console`],
    ['memcached slabs', `/?dashboard=memcached&server=${mcIndex}&tab=slabs`],
    ['memcached items', `/?dashboard=memcached&server=${mcIndex}&tab=items`],
    ['memcached metrics', `/?dashboard=memcached&server=${mcIndex}&tab=metrics`],
    ['memcached watcher', `/?dashboard=memcached&server=${mcIndex}&tab=watcher`],
    ['memcached new-key form', `/?dashboard=memcached&server=${mcIndex}&form=new`],
];

// PHP diagnostics that must never reach a rendered page (display_errors is off
// in production, so seeing one means the message escaped some other way).
const DIAGNOSTIC = /(Fatal error|Parse error|Warning:|Notice:|Deprecated:|Uncaught\s+\w*(Error|Exception))/i;

let failures = [];

const check = (name, ok, detail = '') => {
    if (ok) {
        console.log(`  ok    ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL    ${name}${detail ? ` - ${detail}` : ''}`);
    }
};

console.log(`check-all-panels: probing ${paths.length} pages on ${BASE}\n`);

for (const [name, path] of paths) {
    try {
        const response = await fetch(BASE + path);
        const html = await response.text();

        const diagnostic = html.match(DIAGNOSTIC);

        check(
            `${name} (HTTP ${response.status})`,
            response.ok && !diagnostic,
            !response.ok
                ? `status ${response.status}`
                : `PHP diagnostic leaked: ${diagnostic?.[0]}`
        );
    } catch (error) {
        check(name, false, error.message);
    }
}

if (failures.length > 0) {
    console.error(`\ncheck-all-panels: ${failures.length} of ${paths.length} failed`);
    process.exit(1);
}

console.log(`\ncheck-all-panels: all ${paths.length} pages OK`);
