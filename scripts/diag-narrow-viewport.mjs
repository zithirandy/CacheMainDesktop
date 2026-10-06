/**
 * Settle whether correctionForUsableContent() is reachable in the real app.
 *
 * The fix for the reported "main content collapsed to 339px" state added a
 * startup check that widens the window when the renderer viewport is too narrow.
 * A later measurement showed minWidth:900 already guarantees a ~887px viewport,
 * which would make that check unreachable - but that was reasoned from the
 * viewport mapping, not from the app's own startup path.
 *
 * This drives the REAL BrowserWindow options (including minWidth) through the
 * scenarios that could plausibly produce a narrow viewport:
 *   - a saved geometry from a much larger monitor, clamped to this display
 *   - a saved geometry positioned mostly off-screen
 *   - a saved geometry smaller than the minimums
 * and reports the resulting viewport for each.
 *
 *   node_modules/electron/dist/electron.exe scripts/diag-narrow-viewport.mjs
 */

import {app, BrowserWindow, screen} from 'electron';
import {clampToScreen} from '../lib/window-state.js';

const PAGE = 'data:text/html,<div style="display:flex"><aside style="width:240px"></aside>'
    + '<main style="flex:1"></main></div>';

// The app's real options (main.mjs createMainWindow).
const OPTIONS = {
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#17181c',
    webPreferences: {contextIsolation: true, nodeIntegration: false},
};

app.whenReady().then(async () => {
    const displays = screen.getAllDisplays().map(d => d.workArea);
    console.log(`workAreas: ${JSON.stringify(displays)}\n`);

    const saved = [
        ['saved from a bigger 4K monitor', {x: 0, y: 0, width: 3840, height: 2160}],
        ['saved from a small laptop screen', {x: 0, y: 0, width: 1366, height: 768}],
        ['smaller than the minimums', {x: 0, y: 0, width: 400, height: 300}],
        ['mostly off-screen to the right', {x: 5000, y: 100, width: 1280, height: 840}],
        ['off-screen negative', {x: -4000, y: -3000, width: 1280, height: 840}],
        ['on a monitor that no longer exists', {x: 3000, y: 200, width: 1280, height: 840}],
    ];

    const windows = [];

    for (const [label, state] of saved) {
        const clamped = clampToScreen(state, displays);
        const win = new BrowserWindow({...clamped, ...OPTIONS});
        windows.push({label, state, clamped, win});
    }

    await Promise.all(windows.map(w => w.win.loadURL(PAGE).catch(() => {})));
    await new Promise(r => setTimeout(r, 1500));

    console.log('saved geometry                       -> clamped bounds        viewport      content  verdict');
    console.log('-'.repeat(104));

    let narrow = 0;

    for (const {label, state, clamped, win} of windows) {
        try {
            const bounds = win.getBounds();
            const {w, h} = await win.webContents.executeJavaScript('({w: innerWidth, h: innerHeight})');
            const content = Math.max(0, w - 240);
            const tooNarrow = w < 840;
            if (tooNarrow) narrow++;

            console.log(
                `${label.padEnd(36)} -> ${(bounds.width + 'x' + bounds.height).padEnd(22)} `
                + `${(w + 'x' + h).padEnd(13)} ${String(content).padEnd(8)} `
                + `${tooNarrow ? 'NARROW (correction would fire)' : 'usable'}`
            );
        } catch (error) {
            console.log(`${label.padEnd(36)} -> measure failed: ${error.message}`);
        }
    }

    console.log(`\nviewport < 840px in ${narrow} of ${windows.length} scenarios`);
    console.log(narrow === 0
        ? '=> correctionForUsableContent() is NOT reachable via window geometry.'
        : '=> at least one scenario reaches the correction; it is live code.');

    app.exit(0);
});
