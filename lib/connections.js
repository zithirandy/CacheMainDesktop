/**
 * Connection list management.
 *
 * The list lives in userData/connections.json and is translated into
 * PCA_<TYPE>_<INDEX>_<KEY> environment variables when the PHP backend is
 * spawned. RobiNN\Pca\Config::getEnvConfig() picks them up on the PHP side
 * and json-decodes any value that is valid JSON, which is how object/array
 * options (sentinels, cluster nodes, ssl) pass through.
 */

import {randomUUID} from 'node:crypto';
import {readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

const TYPES = ['redis', 'memcached'];

const DEFAULT_PORT = {
    redis: 6379,
    memcached: 11211,
};

/**
 * Validate a raw connection object from the GUI.
 *
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateConnection(raw) {
    const errors = [];
    const advanced = raw.advanced ?? {};

    if (!TYPES.includes(raw.type)) {
        errors.push(`Unknown connection type "${raw.type}" (redis or memcached).`);
    }

    if (typeof advanced !== 'object' || advanced === null || Array.isArray(advanced)) {
        errors.push('Advanced options must be an object.');
        return {ok: false, errors};
    }

    const hasPath = typeof advanced.path === 'string' && advanced.path !== '';
    const hasNodes = Array.isArray(advanced.nodes) && advanced.nodes.length > 0;

    if (!raw.host && !hasPath && !hasNodes) {
        errors.push('A host is required (or a unix socket path / cluster nodes under Advanced).');
    }

    for (const key of Object.keys(advanced)) {
        // Config::envVarToArray() splits env names on '_', so a key with an
        // underscore would be nested wrongly on the PHP side. Upstream has the
        // same limitation for its own ENV configuration.
        if (key.includes('_')) {
            errors.push(`Advanced key "${key}" cannot contain underscores (env-variable format limitation).`);
        }
    }

    return {ok: errors.length === 0, errors};
}

/**
 * Fill in defaults and drop empty optional fields so the stored JSON stays clean.
 */
export function normalizeConnection(raw) {
    const conn = {
        id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : randomUUID().replace(/-/g, '').slice(0, 12),
        type: raw.type,
    };

    if (raw.name) {
        conn.name = String(raw.name);
    }

    if (raw.host) {
        conn.host = String(raw.host);
    }

    conn.port = Number.isFinite(raw.port) && raw.port > 0 ? raw.port : DEFAULT_PORT[raw.type] ?? 6379;

    if (raw.username) {
        conn.username = String(raw.username);
    }

    if (raw.password) {
        conn.password = String(raw.password);
    }

    conn.database = Number.isFinite(raw.database) ? raw.database : 0;

    const advanced = raw.advanced;
    if (advanced !== null && typeof advanced === 'object' && !Array.isArray(advanced) && Object.keys(advanced).length > 0) {
        conn.advanced = advanced;
    }

    return conn;
}

/**
 * Translate the connection list into PCA_* environment variables.
 *
 * Indexes are re-assigned per type starting at 0 so deleted connections
 * never leave holes. Object/array values are JSON-encoded; the PHP config
 * layer decodes valid JSON back into arrays.
 *
 * @param {Array<object>} connections
 * @returns {Record<string, string>}
 */
export function toEnvVars(connections) {
    const env = {};
    const counters = {};

    for (const conn of connections) {
        if (!TYPES.includes(conn.type)) {
            continue;
        }

        const index = counters[conn.type] ?? 0;
        counters[conn.type] = index + 1;

        const prefix = `PCA_${conn.type.toUpperCase()}_${index}_`;

        const fields = {
            name: conn.name,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            database: conn.database,
            ...conn.advanced,
        };

        for (const [key, value] of Object.entries(fields)) {
            if (value === undefined || value === null || value === '') {
                continue;
            }

            env[prefix + key.toUpperCase()] =
                typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
    }

    return env;
}

/**
 * @returns {Promise<Array<object>>} an empty list for a missing or corrupt file.
 */
export async function loadConnections(file) {
    try {
        const list = JSON.parse(await readFile(file, 'utf8'));
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/**
 * Atomic write (tmp file + rename) so a crash never leaves a half-written list.
 */
export async function saveConnections(file, connections) {
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
    await writeFile(tmp, JSON.stringify(connections, null, 2) + '\n', 'utf8');
    await rename(tmp, file);
}
