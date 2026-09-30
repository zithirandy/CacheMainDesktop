/**
 * CacheMainDesktop - Electron main process.
 *
 * Owns the window, the connection list and the PHP backend lifecycle:
 *   spawn php/php.exe -S 127.0.0.1:<random port> -t webapp
 *   with the connection list injected as PCA_* environment variables.
 */

import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';
import {screen} from 'electron';

import {PhpBackend} from './lib/backend.js';
import {loadConnections, normalizeConnection, saveConnections, toEnvVars, validateConnection} from './lib/connections.js';
import {createFileLogger} from './lib/logger.js';
import {clampToScreen} from './lib/window-state.js';

// Development: project root. Packaged: resources/ next to app.asar.
const BASE = app.isPackaged ? process.resourcesPath : app.getAppPath();
const APP_DIR = import.meta.dirname;

const PHP_EXE = path.join(BASE, 'php', 'php.exe');
const WEBAPP = path.join(BASE, 'webapp');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const CONNECTIONS_FILE = path.join(app.getPath('userData'), 'connections.json');
const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const RUNTIME_FILE = path.join(app.getPath('userData'), 'runtime.json');

// Logs live under the project folder in dev and next to the packaged exe
// when running the portable build (both are writable in the zip layout).
const LOG_DIR = path.join(BASE, 'logs');
const logger = createFileLogger(LOG_DIR);

/** @type {PhpBackend|null} */
let backend = null;

/** @type {BrowserWindow|null} */
let mainWindow = null;

/** @type {BrowserWindow|null} */
let connectionsWindow = null;

let quiting = false;

/** Crash-restart budget for the supervised backend. */
let backendRestarts = 0;

const log = (line, level = 'info') => logger[level](line);

/** Connection summary for logs - hosts and names only, never credentials. */
function connectionSummary(connections) {
    return connections
        .map(conn => `${conn.name || conn.host || conn.advanced?.path || '?'}(${conn.type}${conn.host ? ` ${conn.host}:${conn.port}` : ''})`)
        .join(', ');
}

/**
 * Kill a php.exe left behind by a previous crashed run, so orphans cannot
 * accumulate. The image-name filter guards against a reused PID killing an
 * unrelated process.
 */
function sweepStaleBackend() {
    try {
        const runtime = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8'));
        const pid = Number(runtime?.pid ?? 0);

        if (!Number.isInteger(pid) || pid <= 0) {
            return;
        }

        const listing = execFileSync(
            `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\tasklist.exe`,
            ['/FI', `PID eq ${pid}`, '/FI', 'IMAGENAME eq php.exe', '/FO', 'CSV', '/NH'],
            {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
        ).toString();

        if (listing.includes('php.exe')) {
            execFileSync(
                `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\taskkill.exe`,
                ['/PID', String(pid), '/T', '/F'],
                {stdio: 'ignore'},
            );
            log(`swept stale php.exe (pid ${pid})`);
        }
    } catch {
        // No runtime file or nothing to kill.
    }
}

function rememberBackendPid() {
    if (!backend) {
        return;
    }

    try {
        writeFileSync(RUNTIME_FILE, JSON.stringify({pid: backend.pid, port: backend.port}), 'utf8');
    } catch {
        // Best effort bookkeeping.
    }
}

/**
 * The ipc handlers expose stored credentials, so they are only served to the
 * pages this shell itself loaded: the webapp origin or the packaged ui file.
 */
function isTrustedSender(event) {
    const url = event.senderFrame?.url ?? '';
    const local = backend ? `http://127.0.0.1:${backend.port}/` : 'http://127.0.0.1:1/';

    return url.startsWith(local) || url.startsWith('file://');
}

/**
 * Point the main window at the backend, keeping whatever the user was
 * looking at (dashboard, server, db, tab). Without this every backend
 * restart dumps them back on the first dashboard, which reads as
 * "my change did nothing". A preserved ?server=N index that no longer
 * exists after a connection-list edit is dropped rather than silently
 * pointing at a different server.
 */
async function reloadMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed() || !backend) {
        return;
    }

    let search = '';

    try {
        const params = new URL(mainWindow.webContents.getURL()).searchParams;

        if (params.has('server')) {
            const dashboard = params.get('dashboard') ?? 'redis';
            const connections = await loadConnections(CONNECTIONS_FILE);
            const count = connections.filter(conn => conn.type === dashboard).length;

            if (Number(params.get('server')) >= count) {
                params.delete('server');
            }
        }

        search = params.toString() ? `?${params}` : '';
    } catch {
        // A non-URL (early startup) just reloads the root.
    }

    mainWindow.loadURL(backend.url + '/' + search);
}

/**
 * Crash-loop protection: restart a backend that died mid-session (crash,
 * OOM, user killing it in Task Manager) and put the window back on the new
 * port. Gives up after three consecutive attempts.
 */
async function superviseRestart() {
    if (quiting) {
        return;
    }

    if (backendRestarts >= 3) {
        log('backend died and the restart budget is exhausted, giving up.');
        dialog.showErrorBox('CacheMainDesktop', 'The PHP backend keeps stopping. Please restart the application.');
        return;
    }

    backendRestarts++;

    try {
        const url = await backend.start();
        rememberBackendPid();
        log(`backend restarted automatically (${url})`);
        await reloadMainWindow();
    } catch (error) {
        log(`automatic restart failed: ${error.message}`);
        await superviseRestart();
    }
}

async function loadSettings() {
    try {
        const settings = JSON.parse(await readFile(SETTINGS_FILE, 'utf8'));
        if (settings && typeof settings.metricsHash === 'string') {
            return settings;
        }
    } catch {
        // First launch.
    }

    const settings = {metricsHash: randomBytes(16).toString('hex')};
    await writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    return settings;
}

/**
 * The environment handed to the PHP backend: writable directories in
 * userData plus the whole connection list as PCA_* variables.
 */
function backendEnv(connections, metricsHash) {
    return {
        ...toEnvVars(connections),
        PCA_TMPDIR: DATA_DIR,
        PCA_METRICSDIR: path.join(DATA_DIR, 'metrics'),
        PCA_TWIGCACHE: path.join(DATA_DIR, 'twig'),
        PCA_HASH: metricsHash,
    };
}

function workAreas() {
    try {
        return screen.getAllDisplays().map(display => display.workArea);
    } catch {
        return [];
    }
}

function createMainWindow(url) {
    const clamped = clampToScreen(loadWindowStateSync(), workAreas());

    mainWindow = new BrowserWindow({
        ...clamped,
        minWidth: 900,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        backgroundColor: '#17181c',
        title: 'CacheMainDesktop',
        webPreferences: {
            preload: path.join(APP_DIR, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.on('close', () => {
        if (mainWindow && !mainWindow.isDestroyed() && !quiting) {
            saveWindowStateSync(mainWindow.getNormalBounds());
        }
    });

    // GitHub links etc. open in the system browser, never as Electron windows.
    mainWindow.webContents.setWindowOpenHandler(({url: target}) => {
        if (/^https?:\/\//.test(target)) {
            shell.openExternal(target);
        }

        return {action: 'deny'};
    });

    // Never let the main frame navigate away from the webapp: any other
    // document would still receive the preload bridge.
    mainWindow.webContents.on('will-navigate', (event, target) => {
        if (!target.startsWith(backend ? `http://127.0.0.1:${backend.port}/` : 'http://127.0.0.1:1/')) {
            event.preventDefault();

            if (/^https?:\/\//.test(target)) {
                shell.openExternal(target);
            }
        }
    });

    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });

    mainWindow.loadURL(url);

    return mainWindow;
}

function loadWindowStateSync() {
    try {
        return JSON.parse(readFileSync(WINDOW_STATE_FILE, 'utf8'));
    } catch {
        return {width: 1280, height: 840};
    }
}

function saveWindowStateSync(bounds) {
    try {
        writeFileSync(WINDOW_STATE_FILE, JSON.stringify(bounds), 'utf8');
    } catch {
        // Non-fatal, geometry is a convenience.
    }
}

async function createConnectionsWindow() {
    if (connectionsWindow && !connectionsWindow.isDestroyed()) {
        connectionsWindow.focus();
        return;
    }

    const primary = workAreas()[0] ?? {x: 0, y: 0, width: 1280, height: 840};

    connectionsWindow = new BrowserWindow({
        width: Math.min(620, primary.width - 80),
        height: Math.min(720, primary.height - 80),
        x: primary.x + Math.floor((primary.width - 620) / 2),
        y: primary.y + Math.floor((primary.height - 720) / 2),
        minimizable: false,
        maximizable: false,
        autoHideMenuBar: true,
        backgroundColor: '#17181c',
        title: 'Connections',
        parent: mainWindow ?? undefined,
        modal: mainWindow !== null,
        show: false,
        webPreferences: {
            preload: path.join(APP_DIR, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    connectionsWindow.once('ready-to-show', () => connectionsWindow.show());
    connectionsWindow.on('closed', () => {
        connectionsWindow = null;
    });

    // Match the main window's theme so the two windows never disagree.
    let theme = 'system';

    if (mainWindow && !mainWindow.isDestroyed()) {
        theme = await mainWindow.webContents
            .executeJavaScript("localStorage.getItem('theme') || 'system'")
            .catch(() => 'system');
    }

    connectionsWindow.loadFile(path.join(APP_DIR, 'ui', 'connections.html'), {query: {theme: String(theme)}});
}

async function restartBackend(metricsHash) {
    const connections = await loadConnections(CONNECTIONS_FILE);
    log(`backend start: ${connections.length} connection(s): ${connectionSummary(connections) || 'none'}`);

    if (!backend) {
        backend = new PhpBackend({
            phpExe: PHP_EXE,
            docroot: WEBAPP,
            env: backendEnv(connections, metricsHash),
            logger: line => log(`php ${line}`),
            onUnexpectedExit: () => {
                log('backend exited unexpectedly, supervisor will restart it', 'warn');
                superviseRestart().catch(error => log(`supervisor failed: ${error.message}`, 'error'));
            },
        });

        const url = await backend.start();
        log(`backend ready at ${url} (pid ${backend.pid}), log dir: ${LOG_DIR}`);
        rememberBackendPid();
        return url;
    }

    const url = await backend.restart(backendEnv(connections, metricsHash));
    backendRestarts = 0; // A manual restart resets the crash budget.
    log(`backend restarted at ${url} (pid ${backend.pid})`);
    rememberBackendPid();
    return url;
}

function registerIpc(metricsHash) {
    ipcMain.handle('app:open-connections', event => {
        if (!isTrustedSender(event)) {
            log(`open-connections refused for untrusted sender ${event.senderFrame?.url ?? '?'}`, 'warn');
            return false;
        }

        createConnectionsWindow();
        return true;
    });

    ipcMain.handle('connections:list', event => {
        if (!isTrustedSender(event)) {
            return [];
        }

        return loadConnections(CONNECTIONS_FILE);
    });

    ipcMain.handle('connections:save', async (event, list) => {
        if (!isTrustedSender(event)) {
            return {ok: false, errors: ['Untrusted sender.']};
        }

        if (!Array.isArray(list)) {
            return {ok: false, errors: ['The connection list is invalid.']};
        }

        const errors = [];
        list.forEach((raw, index) => {
            const {ok, errors: entryErrors} = validateConnection(raw);
            if (!ok) {
                errors.push(`#${index + 1}: ${entryErrors.join(' ')}`);
            }
        });

        if (errors.length > 0) {
            log(`connections save rejected: ${errors.join(' ')}`, 'warn');
            return {ok: false, errors};
        }

        const connections = list.map(normalizeConnection);
        await saveConnections(CONNECTIONS_FILE, connections);
        log(`connections saved: ${connectionSummary(connections) || 'none'}`);

        // A changed list means a changed environment for PHP. If the restart
        // fails the list is still saved - report honestly and try one plain
        // start so the window is never left pointing at a dead port.
        let warning = '';

        try {
            await restartBackend(metricsHash);
        } catch (error) {
            log(`restart after save failed: ${error.message}`, 'error');

            try {
                const url = await backend.start();
                rememberBackendPid();
                warning = `Connections saved, but the backend restart failed (${error.message}). Retried on ${url}.`;
            } catch {
                return {ok: false, errors: [`Connections saved, but the backend could not be started: ${error.message}`]};
            }
        }

        await reloadMainWindow();

        return {ok: true, errors: [], warning};
    });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }

            mainWindow.focus();
        }
    });

    app.whenReady().then(async () => {
        sweepStaleBackend();

        log(`CacheMainDesktop starting: app ${app.getVersion()}, electron ${process.versions.electron}, node ${process.versions.node}`);
        log(`base dir ${BASE}, packaged=${app.isPackaged}, log dir ${LOG_DIR}`);

        await mkdir(path.join(DATA_DIR, 'metrics'), {recursive: true});
        await mkdir(path.join(DATA_DIR, 'twig'), {recursive: true});

        const settings = await loadSettings();
        registerIpc(settings.metricsHash);

        try {
            const url = await restartBackend(settings.metricsHash);
            createMainWindow(url);
        } catch (error) {
            log(`backend failed: ${error.message}`);
            dialog.showErrorBox(
                'CacheMainDesktop',
                `The PHP backend could not be started.\n\n${error.message}`,
            );
            app.quit();
        }
    }).catch(error => {
        // Anything outside the try above (settings write, data dirs, ...)
        // must still surface and exit instead of leaving a headless process.
        dialog.showErrorBox('CacheMainDesktop', `Startup failed.\n\n${error.message}`);
        app.quit();
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

    app.on('before-quit', () => {
        quiting = true;
        log('app quitting');

        if (mainWindow && !mainWindow.isDestroyed()) {
            saveWindowStateSync(mainWindow.getNormalBounds());
        }

        // taskkill inside stop() is synchronous, the tree dies with us.
        if (backend) {
            backend.stop().catch(() => {});
        }
    });
}
