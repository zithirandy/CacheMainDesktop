/**
 * Window geometry persistence: restore size/position between launches and
 * refuse states that no longer fit any connected display (e.g. the window
 * was on a monitor that got unplugged).
 */

import {readFile, writeFile} from 'node:fs/promises';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 840;

const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

/**
 * A first-launch state. x/y are resolved by the caller against a display.
 */
export function defaultState() {
    return {width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT};
}

/**
 * Clamp a persisted state to the currently connected displays.
 *
 * @param {{x?: number, y?: number, width?: number, height?: number}} state
 * @param {Array<{x: number, y: number, width: number, height: number}>} displays workArea bounds
 */
export function clampToScreen(state, displays) {
    if (displays.length === 0) {
        return defaultState();
    }

    let {x = 0, y = 0, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT} = state;

    width = Math.min(Math.max(width, MIN_WIDTH), ...displays.map(d => d.width));
    height = Math.min(Math.max(height, MIN_HEIGHT), ...displays.map(d => d.height));

    // At least 120px of the title bar must stay reachable on some display.
    const reachable = displays.some(d =>
        x >= d.x - width + 120 && x <= d.x + d.width - 120 &&
        y >= d.y && y <= d.y + d.height - 60,
    );

    if (!reachable) {
        const primary = displays[0];
        x = primary.x + Math.floor((primary.width - width) / 2);
        y = primary.y + Math.floor((primary.height - height) / 2);
    }

    return {x, y, width, height};
}

export async function loadWindowState(file) {
    try {
        const state = JSON.parse(await readFile(file, 'utf8'));
        if (typeof state === 'object' && state !== null) {
            return state;
        }
    } catch {
        // Missing or corrupt state is not an error, first launch just centers.
    }

    return defaultState();
}

export async function saveWindowState(file, bounds) {
    await writeFile(file, JSON.stringify(bounds, null, 2), 'utf8');
}
