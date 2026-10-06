/**
 * PHP backend supervisor.
 *
 * Spawns the bundled portable PHP built-in server (php.exe -S) bound to
 * 127.0.0.1 on a random free port, waits until it answers, and can restart
 * it with a fresh environment (used when the connection list changes).
 *
 * Deliberately free of any Electron import so scripts/smoke.mjs can drive
 * it headlessly.
 */

import {spawn, execFileSync} from 'node:child_process';
import {mkdirSync, realpathSync} from 'node:fs';
import {createServer} from 'node:net';
import path from 'node:path';

const LOOPBACK = '127.0.0.1';

/**
 * @returns {Promise<number>} a free TCP port chosen by the OS.
 */
export function randomFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.unref();
        server.on('error', reject);
        server.listen(0, LOOPBACK, () => {
            const {port} = server.address();
            server.close(() => resolve(port));
        });
    });
}

export class PhpBackend {
    /**
     * @param {{phpExe: string, docroot: string, env?: Object, logger?: (line: string) => void, onUnexpectedExit?: () => void}} options
     */
    constructor({phpExe, docroot, env = {}, logger = () => {}, onUnexpectedExit = null}) {
        // Absolute from here on: the child process gets cwd = the PHP folder,
        // which would break a relative phpExe path.
        this.phpExe = PhpBackend.#longPath(path.resolve(phpExe));
        this.docroot = PhpBackend.#longPath(path.resolve(docroot));
        this.env = env;
        this.logger = logger;
        this.onUnexpectedExit = onUnexpectedExit;

        this.child = null;
        this.port = 0;
        this.pid = 0;
        this.stopping = false;
        this.starting = null;
        this.spawnError = null;
    }

    /**
     * Expand a Windows 8.3 SHORT path (C:\Users\ADMINI~1\...) to its long form.
     *
     * Short paths contain a "~", and PHP's ini parser rejects that:
     *
     *   PHP: syntax error, unexpected '~' in Unknown on line 1
     *   Fatal Error opcache.file_cache must be a full path of an accessible directory
     *
     * Verified by running the identical extracted build through both spellings of
     * the same folder - the short one dies, the long one starts. A user whose
     * install path contains a long component can hit this with no obvious cause,
     * so expand before any path reaches php.exe.
     *
     * @param {string} target
     * @returns {string}
     */
    static #longPath(target) {
        try {
            return realpathSync.native(target);
        } catch {
            // Not resolvable (missing, permission) - leave it for the caller.
            return target;
        }
    }

    get url() {
        return `http://${LOOPBACK}:${this.port}`;
    }

    /**
     * `-d` arguments that keep the bundled PHP starting reliably.
     *
     * The portable runtime intermittently dies at startup with
     *
     *   Fatal Error Opcode handlers are unusable due to ASLR.
     *   Please setup opcache.file_cache and opcache.file_cache_fallback directives
     *
     * Measured on this machine, 12 boots per configuration: plain spawn 0/12,
     * file_cache_fallback alone 0/12, an ABSOLUTE opcache.file_cache plus the
     * fallback 12/12. So the file cache is what actually matters - but php.ini
     * cannot carry it, because a portable install has no fixed path and a
     * relative value ("tmp/opcache") makes PHP refuse to start outright with
     * "opcache.file_cache must be a full path of an accessible directory".
     *
     * Passing it here solves both problems: this process knows where php.exe
     * lives, so it can compute an absolute directory at runtime.
     */
    #opcacheArgs() {
        const cacheDir = PhpBackend.#longPath(path.join(path.dirname(this.phpExe), 'tmp', 'opcache'));

        try {
            mkdirSync(cacheDir, {recursive: true});
        } catch {
            // If it cannot be created, fall back to the plain spawn: a missing
            // file cache is better than refusing to build the command line.
            return [];
        }

        return ['-d', `opcache.file_cache=${cacheDir}`, '-d', 'opcache.file_cache_fallback=1'];
    }

    get running() {
        return this.child !== null && this.child.exitCode === null;
    }

    /**
     * Start the server and resolve once it answers an HTTP request.
     *
     * @param {{timeoutMs?: number}} options
     * @returns {Promise<string>} the base URL
     */
    async start({timeoutMs = 20_000} = {}) {
        if (this.starting) {
            return this.starting;
        }

        this.starting = this.#startInternal(timeoutMs).finally(() => {
            this.starting = null;
        });

        return this.starting;
    }

    async #startInternal(timeoutMs) {
        if (this.running) {
            return this.url;
        }

        this.stopping = false;
        this.spawnError = null;
        this.port = await randomFreePort();

        this.child = spawn(this.phpExe, [...this.#opcacheArgs(), '-S', `${LOOPBACK}:${this.port}`, '-t', this.docroot], {
            cwd: path.dirname(this.phpExe),
            env: {...process.env, ...this.env},
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.pid = this.child.pid ?? 0;

        // Without a listener, a failed spawn (php.exe missing, blocked by AV)
        // raises an uncaught 'error' event and takes the whole process down.
        this.child.on('error', error => {
            this.spawnError = error;
            this.child = null;
            this.logger(`php backend failed to spawn: ${error.message}`);
        });

        this.#pipe(this.child.stdout, 'php[out]');
        this.#pipe(this.child.stderr, 'php[err]');

        this.child.on('exit', (code) => {
            this.logger(`php backend exited with code ${code}`);
            this.child = null;
            this.pid = 0;

            if (!this.stopping && this.onUnexpectedExit) {
                this.onUnexpectedExit();
            }
        });

        await this.#waitUntilReady(timeoutMs);

        return this.url;
    }

    #pipe(stream, prefix) {
        let buffer = '';

        stream.setEncoding('utf8');
        stream.on('data', chunk => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) !== -1) {
                this.logger(`${prefix} ${buffer.slice(0, newline).trimEnd()}`);
                buffer = buffer.slice(newline + 1);
            }
        });
    }

    async #waitUntilReady(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        const probe = `${this.url}/assets/favicon.png`;

        while (Date.now() < deadline) {
            if (this.spawnError) {
                throw new Error(`Could not start ${this.phpExe}: ${this.spawnError.message}`);
            }

            if (!this.running) {
                throw new Error(`The PHP backend exited before it became ready (${this.phpExe}).`);
            }

            try {
                const response = await fetch(probe, {signal: AbortSignal.timeout(750)});
                if (response.ok) {
                    return;
                }
            } catch {
                // Not up yet, keep polling.
            }

            await new Promise(resolve => setTimeout(resolve, 150));
        }

        await this.stop();
        throw new Error(`The PHP backend did not answer within ${timeoutMs} ms.`);
    }

    /**
     * Hard-stop the process tree. php.exe -S does not fork children, but
     * taskkill /T also covers anything PHP might have spawned.
     */
    async stop() {
        const child = this.child;
        if (!child || child.exitCode !== null) {
            this.child = null;
            return;
        }

        this.stopping = true;

        try {
            execFileSync(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`,
                ['/PID', String(child.pid), '/T', '/F'], {stdio: 'ignore'});
        } catch {
            // Already gone; fall through to the exit wait.
            child.kill();
        }

        await new Promise(resolve => {
            if (child.exitCode !== null) {
                resolve();
                return;
            }

            child.once('exit', resolve);
            setTimeout(resolve, 3000).unref();
        });

        this.child = null;
        this.stopping = false;
    }

    /**
     * Restart with a new environment (e.g. an updated connection list).
     *
     * @param {Object} env
     * @returns {Promise<string>} the new base URL
     */
    async restart(env) {
        this.env = env;
        await this.stop();
        return this.start();
    }
}
