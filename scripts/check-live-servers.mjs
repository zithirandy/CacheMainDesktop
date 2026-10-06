/**
 * End-to-end check against the local docker test servers.
 *
 * Boots the bundled PHP backend with a Redis + Memcached connection, then drives
 * a real browser through Playwright to prove the dashboard actually renders the
 * keys that scripts/test-redis-seed.sh / test-memcached-seed.py put there.
 *
 *   1. start the servers:   docker compose -f docker-compose.test.yml up -d
 *   2. seed them:           bash scripts/test-redis-seed.sh
 *                           python scripts/test-memcached-seed.py
 *   3. run this:            node scripts/check-live-servers.mjs
 *
 * Credentials come from the environment (never hardcoded into the repo):
 *   PCA_TEST_REDIS_HOST / PCA_TEST_REDIS_PORT / PCA_TEST_REDIS_PASSWORD
 *   PCA_TEST_MC_HOST / PCA_TEST_MC_PORT
 * Debug screenshots go outside the repo via shotsDir().
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {PhpBackend} from '../lib/backend.js';
import {toEnvVars} from '../lib/connections.js';
import {launchBrowser, shotsDir, TEST_ENV} from './lib/test-env.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const redisHost = TEST_ENV.redisHost;
const redisPort = Number(TEST_ENV.redisPort);
const mcHost = TEST_ENV.mcHost;
const mcPort = Number(TEST_ENV.mcPort);

const connections = [
    {
        id: 'livetestredis',
        type: 'redis',
        name: 'Docker Redis',
        host: redisHost,
        port: redisPort,
        password: TEST_ENV.redisPassword,
        database: 0,
    },
    {
        // A second Redis entry so the dashboard renders its server selector.
        id: 'livetestredis2',
        type: 'redis',
        name: 'Docker Redis (db1)',
        host: redisHost,
        port: redisPort,
        password: TEST_ENV.redisPassword,
        database: 1,
    },
    {
        id: 'livetestmc',
        type: 'memcached',
        name: 'Docker Memcached',
        host: mcHost,
        port: mcPort,
    },
    {
        id: 'livetestmc2',
        type: 'memcached',
        name: 'Docker Memcached 2',
        host: mcHost,
        port: mcPort,
    },
];

const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok  ${name}`);
    } else {
        failures.push(name);
        console.error(`FAIL  ${name}${detail ? ` - ${detail}` : ''}`);
    }
}

const backend = new PhpBackend({
    phpExe: path.join(ROOT, 'php', 'php.exe'),
    docroot: path.join(ROOT, 'webapp'),
    env: {
        ...toEnvVars(connections),
        PCA_TMPDIR: path.join(ROOT, 'webapp', 'tmp'),
        PCA_METRICSDIR: path.join(ROOT, 'webapp', 'tmp', 'metrics'),
        PCA_TWIGCACHE: path.join(ROOT, 'webapp', 'tmp', 'twig'),
        PCA_HASH: 'liveservers',
    },
    logger: line => console.log(`       ${line}`),
});

let browser;

/**
 * Put the fixture keys in place before asserting on them.
 *
 * This used to rely on scripts/test-redis-seed.sh / test-memcached-seed.py having
 * been run first, and one of those fixtures carried a 600s TTL - so the check
 * failed whenever it ran more than ten minutes later, for reasons that had
 * nothing to do with the app. Seeding here (and never expiring anything) makes
 * the result depend only on the code under test.
 */
async function seedFixtures() {
    // --- Redis: one key per type so the type badges and sizes have something to show.
    const redisCmds = [
        ['SET', 'greeting', 'hello from docker redis'],
        ['SET', 'counter', '42'],
        ['HSET', 'user:1', 'name', 'Ada', 'role', 'engineer'],
        ['RPUSH', 'queue:tasks', 'task-a', 'task-b', 'task-c'],
        ['SADD', 'tags:prod', 'redis', 'cache', 'memcached'],
        ['ZADD', 'leaderboard', '100', 'alice', '250', 'bob'],
    ];

    const {createConnection} = await import('node:net');

    const sendRedis = commands => new Promise((resolve, reject) => {
        const socket = createConnection({host: redisHost, port: redisPort});
        let buffer = '';

        socket.on('connect', () => socket.write(commands));
        socket.on('data', chunk => {
            buffer += chunk.toString();
            // One reply per command is enough to know it was accepted.
            if (buffer.split('\r\n').filter(Boolean).length >= commands.split('\r\n').length / 2) {
                socket.end();
                resolve(buffer);
            }
        });
        socket.on('error', reject);
        socket.on('end', () => resolve(buffer));
        setTimeout(() => {
            socket.destroy();
            resolve(buffer);
        }, 3000).unref();
    });

    const encode = args => {
        let out = `*${args.length}\r\n`;
        for (const arg of args) {
            out += `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`;
        }
        return out;
    };

    const wire = redisCmds.map(encode).join('');
    await sendRedis(wire);
    console.log(`live-check: seeded ${redisCmds.length} redis keys`);

    // --- Memcached: no expiry on any of these, so nothing can rot between runs.
    const mcSeed = [
        ['greeting', 'hello from memcached!', 0],
        ['counter', '42', 0],
        ['session:abc', 'token-value', 0],
        ['user:1:name', 'Ada', 0],
    ];

    await new Promise((resolve, reject) => {
        const socket = createConnection({host: mcHost, port: mcPort});
        let payload = '';

        for (const [key, value, ttl] of mcSeed) {
            payload += `set ${key} 0 ${ttl} ${Buffer.byteLength(value)}\r\n${value}\r\n`;
        }

        socket.on('connect', () => socket.write(payload));
        socket.on('data', () => {
            socket.end();
            resolve();
        });
        socket.on('error', reject);
        socket.on('end', resolve);
        setTimeout(() => {
            socket.destroy();
            resolve();
        }, 3000).unref();
    });

    console.log(`live-check: seeded ${mcSeed.length} memcached keys`);
}

try {
    console.log('live-check: starting the PHP backend...');

    await seedFixtures();

    const url = await backend.start();
    console.log(`live-check: backend at ${url}`);

    // --- raw HTTP first: cheap and tells us whether it is a server problem or
    // --- a rendering problem if something fails.
    const redisHtml = await fetch(`${url}/?dashboard=redis&server=0`).then(r => r.text());
    check('the saved Redis connection name renders', redisHtml.includes('Docker Redis'));
    check('redis dashboard has no "No servers" placeholder', !redisHtml.includes('No servers'));

    const mcHtml = await fetch(`${url}/?dashboard=memcached&server=0`).then(r => r.text());
    check('the saved Memcached connection name renders', mcHtml.includes('Docker Memcached'));

    // --- then the real thing: a browser, so AJAX-loaded panels are included.
    console.log('live-check: launching the browser...');
    browser = await launchBrowser();
    const page = await browser.newPage({viewport: {width: 1500, height: 950}});

    const shots = shotsDir();

    await page.goto(`${url}/?dashboard=redis&server=0`, {waitUntil: 'networkidle'});
    await page.waitForTimeout(3000);

    const redisBody = await page.evaluate(() => document.body.innerText);

    for (const key of ['greeting', 'counter', 'user:1', 'queue:tasks', 'tags:prod', 'leaderboard']) {
        check(`redis shows seeded key "${key}"`, redisBody.includes(key));
    }

    check('redis reports a real version, not N/A', !/Version\s+N\/A/.test(redisBody));
    check('redis connection is not refused',
        !/拒绝|refused|Unable to connect|Connection refused/i.test(redisBody));

    await page.screenshot({path: `${shots}/live-redis.png`, fullPage: true});
    console.log(`live-check: wrote ${shots}/live-redis.png`);

    await page.goto(`${url}/?dashboard=memcached&server=0`, {waitUntil: 'networkidle'});
    await page.waitForTimeout(3000);

    const mcBody = await page.evaluate(() => document.body.innerText);

    for (const key of ['greeting', 'counter', 'session:abc', 'user:1:name']) {
        check(`memcached shows seeded key "${key}"`, mcBody.includes(key));
    }

    check('memcached connection is not refused',
        !/拒绝|refused|Unable to connect|Connection refused/i.test(mcBody));

    await page.screenshot({path: `${shots}/live-memcached.png`, fullPage: true});
    console.log(`live-check: wrote ${shots}/live-memcached.png`);
} catch (error) {
    console.error(`live-check: ${error.message}`);
    failures.push(`exception: ${error.message}`);
} finally {
    if (browser) {
        await browser.close();
    }
    await backend.stop();
}

if (failures.length > 0) {
    console.error(`live-check: ${failures.length} check(s) failed.`);
    process.exit(1);
}

console.log('live-check: all checks passed.');
