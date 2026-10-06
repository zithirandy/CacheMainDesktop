/**
 * Probe the real relationship between a requested window size and the renderer
 * viewport, for the app's actual BrowserWindow options.
 *
 * Defect D5 was: a saved geometry of 1289x842 produced a 607px-wide viewport
 * (content area ~339px after the 240px sidebar), while clearing window-state.json
 * fixed it. This measures a spread of sizes so correctionForUsableContent() can
 * be checked against reality rather than a guess.
 *
 * All windows are created up front on purpose: destroying one seems to abort the
 * remaining data-URL loads, which silently truncated an earlier version of this
 * probe to a single row.
 *
 *   node_modules/electron/dist/electron.exe scripts/diag-window-geometry.mjs
 */

import {app, BrowserWindow, screen} from 'electron';

const sizes = [600, 700, 900, 1000, 1100, 1280, 1289, 1440, 1600, 2000];

const PAGE = 'data:text/html,<div style="display:flex;margin:0">'
    + '<aside style="width:240px"></aside><main style="flex:1"></main></div>';

app.whenReady().then(async () => {
    const display = screen.getAllDisplays()[0];
    console.log(`display scaleFactor=${display.scaleFactor}`);
    console.log(`  bounds   ${JSON.stringify(display.bounds)}`);
    console.log(`  workArea ${JSON.stringify(display.workArea)}\n`);

    const windows = sizes.map(width => new BrowserWindow({
        width,
        height: 840,
        minWidth: 900,
        minHeight: 600,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {contextIsolation: true, nodeIntegration: false},
    }));

    await Promise.all(windows.map(win => win.loadURL(PAGE).catch(() => {})));
    await new Promise(r => setTimeout(r, 1500));

    console.log('requested   getBounds    viewport      mainContent  ratio   verdict');
    console.log('-'.repeat(76));

    for (const [i, win] of windows.entries()) {
        try {
            const bounds = win.getBounds();
            const viewport = await win.webContents.executeJavaScript(
                '({w: innerWidth, h: innerHeight})'
            );

            const content = Math.max(0, viewport.w - 240);
            const ratio = (bounds.width / viewport.w).toFixed(3);
            const usable = content >= 600;

            console.log(
                `${String(sizes[i]).padEnd(11)} ${String(bounds.width).padEnd(12)} `
                + `${(viewport.w + 'x' + viewport.h).padEnd(13)} ${String(content).padEnd(12)} `
                + `${ratio.padEnd(7)} ${usable ? 'usable' : 'TOO NARROW'}`
            );
        } catch (error) {
            console.log(`${String(sizes[i]).padEnd(11)} (failed: ${error.message})`);
        }
    }

    console.log('\nratio ~1.0 => bounds and viewport share units (no scale mismatch).');
    console.log('"TOO NARROW" rows are exactly what correctionForUsableContent() must fix.');

    app.exit(0);
});
