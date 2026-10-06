/**
 * Entry point: fail loudly if the app was not started as Electron.
 *
 * Why this file exists
 * --------------------
 * When the environment variable ELECTRON_RUN_AS_NODE is set, an Electron
 * executable degrades into plain Node: it does not load any window code. This
 * app then behaves in one of two confusing ways, both verified:
 *
 *   CacheMainDesktop.exe --remote-debugging-port=19450
 *     -> "CacheMainDesktop.exe: bad option: --remote-debugging-port=19450"
 *   CacheMainDesktop.exe
 *     -> exits immediately with code 9 and NO output at all
 *
 * ELECTRON_RUN_AS_NODE is exported by various tools (VS Code extension hosts,
 * some npm/Electron build pipelines, and the DSH harness), so a user can hit
 * this by launching the app from such a shell without touching the app itself.
 * "Silent exit, no message" is the worst possible failure for a desktop app.
 *
 * A guard inside main.mjs cannot fix this: ES module imports are hoisted and
 * evaluated before the module body runs, so `import {app} from 'electron'`
 * throws before any check could execute. A CommonJS entry point runs first, so
 * this is the earliest place the misconfiguration can be reported.
 *
 * Written as CJS on purpose - it must load under plain Node, where the ESM
 * loader is already partway through starting the app.
 */

'use strict';

const asNode = process.env.ELECTRON_RUN_AS_NODE;

/**
 * Are we actually being hosted by Electron?
 *
 * Not checkable via process.versions.electron: under ELECTRON_RUN_AS_NODE the
 * probe shows it still reports the Electron version (44.4.5), which is why an
 * earlier version of this guard let the failure through and the app died later
 * with a confusing "does not provide an export named 'BrowserWindow'".
 *
 * The reliable signals are process.type (set to 'browser'/'renderer' only in a
 * real Electron process) and the variable itself.
 */
const hostedByElectron = process.env.ELECTRON_RUN_AS_NODE === undefined
    && typeof process.type === 'string'
    && process.type !== 'node';

if (!hostedByElectron) {
    const lines = [
        '',
        'CacheMainDesktop could not start as a desktop application.',
        '',
        'It was launched with ELECTRON_RUN_AS_NODE set, which makes the Electron',
        'runtime behave as plain Node.js. In that mode the app cannot open a window.',
        '',
    ];

    if (asNode !== undefined) {
        lines.push(
            `  ELECTRON_RUN_AS_NODE=${asNode}`,
            '',
            'To run the app, clear that variable first:',
            '',
            '  PowerShell :  Remove-Item Env:\\ELECTRON_RUN_AS_NODE',
            '  cmd.exe    :  set ELECTRON_RUN_AS_NODE=',
            '  bash       :  unset ELECTRON_RUN_AS_NODE',
            '',
            'This variable is often exported by a parent tool (an editor, a build',
            'script or an automation host) rather than set by you directly, so',
            'clearing it for the app launch is usually enough.',
        );
    } else {
        lines.push('The Electron runtime was not detected for an unknown reason.');
    }

    lines.push('');

    process.stderr.write(lines.join('\n') + '\n');
    process.exit(1);
}

// Normal launch: hand over to the real main process.
import('./main.mjs').catch(error => {
    process.stderr.write(`CacheMainDesktop failed to start: ${error?.stack ?? error}\n`);
    process.exit(1);
});
