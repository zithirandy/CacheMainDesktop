/**
 * CacheMainDesktop - Electron main process.
 *
 * Owns the window, the connection list and the PHP backend lifecycle:
 *   spawn php/php.exe -S 127.0.0.1:<random port> -t webapp
 *   with the connection list injected as PCA_* environment variables.
 */

import {randomBytes} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {app, BrowserWindow, dialog, ipcMain, shell} from 'electron';
import {screen} from 'electron';

import {PhpBackend} from './lib/backend.js';
import {loadConnections, normalizeConnection, saveConnections, toEnvVars, validateConnection} from './lib/connections.js';
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

/** @type {PhpBackend|null} */
let backend = null;

/** @type {BrowserWindow|null} */
let mainWindow = null;

/** @type {BrowserWindow|null} */
let connectionsWindow = null;

let quiting = false;

const log = line => console.log(`[main] ${line}`);

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

function createConnectionsWindow() {
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

    connectionsWindow.loadFile(path.join(APP_DIR, 'ui', 'connections.html'));
}

async function restartBackend(metricsHash) {
    const connections = await loadConnections(CONNECTIONS_FILE);

    if (!backend) {
        backend = new PhpBackend({
            phpExe: PHP_EXE,
            docroot: WEBAPP,
            env: backendEnv(connections, metricsHash),
            logger: line => log(`php ${line}`),
        });

        return backend.start();
    }

    return backend.restart(backendEnv(connections, metricsHash));
}

function registerIpc(metricsHash) {
    ipcMain.handle('app:open-connections', () => {
        createConnectionsWindow();
        return true;
    });

    ipcMain.handle('connections:list', () => loadConnections(CONNECTIONS_FILE));

    ipcMain.handle('connections:save', async (event, list) => {
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
            return {ok: false, errors};
        }

        const connections = list.map(normalizeConnection);
        await saveConnections(CONNECTIONS_FILE, connections);

        // A changed list means a changed environment for PHP.
        await restartBackend(metricsHash);

        if (mainWindow && !mainWindow.isDestroyed() && backend) {
            mainWindow.loadURL(backend.url);
        }

        return {ok: true, errors: []};
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
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

    app.on('before-quit', () => {
        quiting = true;

        if (mainWindow && !mainWindow.isDestroyed()) {
            saveWindowStateSync(mainWindow.getNormalBounds());
        }

        // taskkill inside stop() is synchronous, the tree dies with us.
        if (backend) {
            backend.stop().catch(() => {});
        }
    });
}
