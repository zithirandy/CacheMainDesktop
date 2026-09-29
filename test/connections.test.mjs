import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {
    validateConnection,
    normalizeConnection,
    toEnvVars,
    loadConnections,
    saveConnections,
} from '../lib/connections.js';

describe('validateConnection', () => {
    it('accepts a minimal redis connection', () => {
        const result = validateConnection({type: 'redis', host: '127.0.0.1'});
        assert.deepEqual(result.errors, []);
        assert.equal(result.ok, true);
    });

    it('rejects an unknown type', () => {
        const result = validateConnection({type: 'mongo', host: 'x'});
        assert.equal(result.ok, false);
        assert.ok(result.errors.some(e => e.includes('type')));
    });

    it('rejects a connection with neither host nor path nor nodes', () => {
        const result = validateConnection({type: 'redis'});
        assert.equal(result.ok, false);
        assert.ok(result.errors.some(e => e.includes('host')));
    });

    it('accepts host-less connections when a unix path or cluster nodes exist', () => {
        assert.equal(validateConnection({type: 'redis', advanced: {path: '/tmp/redis.sock'}}).ok, true);
        assert.equal(validateConnection({type: 'redis', advanced: {nodes: ['127.0.0.1:7000']}}).ok, true);
    });

    it('rejects advanced keys containing underscores (upstream env format cannot express them)', () => {
        const result = validateConnection({type: 'redis', host: 'a', advanced: {read_write_timeout: 5}});
        assert.equal(result.ok, false);
        assert.ok(result.errors.some(e => e.includes('read_write_timeout')));
    });

    it('rejects non-object advanced values', () => {
        const result = validateConnection({type: 'redis', host: 'a', advanced: 'oops'});
        assert.equal(result.ok, false);
    });
});

describe('normalizeConnection', () => {
    it('fills defaults and keeps an explicit id', () => {
        const conn = normalizeConnection({id: 'k1', type: 'redis', name: 'Prod', host: 'db1'});
        assert.equal(conn.id, 'k1');
        assert.equal(conn.port, 6379);
        assert.equal(conn.database, 0);
    });

    it('defaults the memcached port per type', () => {
        assert.equal(normalizeConnection({type: 'memcached', host: 'a'}).port, 11211);
    });

    it('drops empty optional fields instead of storing them', () => {
        const conn = normalizeConnection({type: 'redis', host: 'a', username: '', password: '', advanced: {}});
        assert.equal('username' in conn, false);
        assert.equal('advanced' in conn, false);
    });

    it('generates an id when missing', () => {
        const conn = normalizeConnection({type: 'redis', host: 'a'});
        assert.ok(conn.id.length >= 8);
    });
});

describe('toEnvVars', () => {
    it('reindexes connections per type starting at 0', () => {
        const env = toEnvVars([
            {id: 'a', type: 'memcached', name: 'mc', host: 'h1', port: 11211, database: 0},
            {id: 'b', type: 'redis', name: 'r1', host: 'h2', port: 6380, database: 2},
            {id: 'c', type: 'redis', name: 'r2', host: 'h3', port: 6379, database: 0},
        ]);

        assert.equal(env.PCA_REDIS_0_NAME, 'r1');
        assert.equal(env.PCA_REDIS_0_PORT, '6380');
        assert.equal(env.PCA_REDIS_0_DATABASE, '2');
        assert.equal(env.PCA_REDIS_1_NAME, 'r2');
        assert.equal(env.PCA_MEMCACHED_0_NAME, 'mc');
        assert.equal(env.PCA_MEMCACHED_0_PORT, '11211');
    });

    it('serializes object/array advanced values as JSON (decoded as arrays by Config)', () => {
        const env = toEnvVars([{
            id: 'a', type: 'redis', name: 'cluster', host: '', port: 6379, database: 0,
            advanced: {nodes: ['127.0.0.1:7000', '127.0.0.1:7001'], ssl: {verify_peer: true}},
        }]);

        assert.deepEqual(JSON.parse(env.PCA_REDIS_0_NODES), ['127.0.0.1:7000', '127.0.0.1:7001']);
        assert.deepEqual(JSON.parse(env.PCA_REDIS_0_SSL), {verify_peer: true});
    });

    it('passes scalar advanced values through as strings', () => {
        const env = toEnvVars([{
            id: 'a', type: 'redis', name: 'x', host: 'h', port: 6379, database: 0,
            advanced: {path: '/tmp/redis.sock', separator: ':'},
        }]);

        assert.equal(env.PCA_REDIS_0_PATH, '/tmp/redis.sock');
        assert.equal(env.PCA_REDIS_0_SEPARATOR, ':');
    });

    it('skips empty host and blank optional fields entirely', () => {
        const env = toEnvVars([{id: 'a', type: 'redis', name: 'sock', host: '', port: 0, database: 0}]);

        assert.equal('PCA_REDIS_0_HOST' in env, false);
        assert.equal('PCA_REDIS_0_PASSWORD' in env, false);
    });

    it('returns an empty object for an empty list', () => {
        assert.deepEqual(toEnvVars([]), {});
    });

    it('ignores connections of an unknown type', () => {
        const env = toEnvVars([{id: 'a', type: 'bogus', name: 'x', host: 'h', port: 1, database: 0}]);
        assert.deepEqual(env, {});
    });
});

describe('load/save round-trip', () => {
    it('round-trips a connection list through disk', async () => {
        const file = await import('node:fs/promises').then(fs =>
            fs.mkdtemp(`${process.env.TEMP ?? '/tmp'}/pca-conn-`)).then(dir => `${dir}/connections.json`);

        const list = [
            {id: 'abc12345', type: 'redis', name: 'Prod', host: 'p', port: 6379, database: 1, password: 's§cret'},
        ];

        await saveConnections(file, list);
        assert.deepEqual(await loadConnections(file), list);
    });

    it('returns an empty list for a missing or corrupt file', async () => {
        assert.deepEqual(await loadConnections('Z:/definitely/not/there.json'), []);

        const dir = await import('node:fs/promises').then(fs => fs.mkdtemp(`${process.env.TEMP ?? '/tmp'}/pca-conn-`));
        const corrupt = `${dir}/corrupt.json`;
        await import('node:fs/promises').then(fs => fs.writeFile(corrupt, '{not json'));
        assert.deepEqual(await loadConnections(corrupt), []);
    });
});
