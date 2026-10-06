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
 * The main window's layout is [240px sidebar | content]. Below this the key
 * table and edit forms collapse into an unusable strip, so the *content* area -
 * not just the window - needs a floor.
 */
const MIN_CONTENT_WIDTH = 600;

/**
 * Relative tolerance when comparing a persisted width with what Electron
 * actually rendered. Values outside it are treated as "not the same units"
 * (a window-state file written on a differently scaled display, for instance)
 * rather than as a rounding difference.
 */
const SCALE_TOLERANCE = 0.05;

/** @type {number|null} */
let lastAppliedContentWidth = null;

/**
 * For tests: forget the memo so each case starts clean.
 */
export function resetClampMemo() {
    lastAppliedContentWidth = null;
}

/**
 * Guarantee the launched window leaves a usable content area.
 *
 * `clampToScreen` keeps a persisted geometry on-screen and above the window
 * minimums, but a saved size can still be wrong for the current display: a
 * window-state.json written against another resolution or scale factor gets
 * restored at face value, and the sidebar eats a fixed 240px of it. Clearing
 * the file fixed the reported case, which is exactly the symptom of a bad
 * persisted geometry.
 *
 * So the outcome here is verified rather than predicted: the renderer reports
 * the real CSS-pixel viewport, and when that is too narrow the missing pixels
 * are added on (or the ratio mismatch is undone) and written back so the next
 * launch starts healthy.
 *
 * @param {{width: number, height: number}} bounds   window.getBounds()
 * @param {{width: number}} viewport                 renderer innerWidth/innerHeight
 * @param {{width: number, height: number}} workArea of the window's display
 * @returns {{width: number, height: number}|null}    correction to apply, or null
 */
export function correctionForUsableContent(bounds, viewport, workArea) {
    if (!bounds || !viewport || !workArea) {
        return null;
    }

    const {width: boundWidth} = bounds;
    const {width: viewportWidth} = viewport;

    if (!Number.isFinite(boundWidth) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
        return null;
    }

    // Already sane: remember it and leave the window alone.
    if (viewportWidth >= MIN_CONTENT_WIDTH + 240) {
        lastAppliedContentWidth = boundWidth;
        return null;
    }

    // A second pass over a width we already corrected means adding pixels is not
    // what this needs (an unexpectedly narrow display, say). Do not fight it.
    const previous = lastAppliedContentWidth;

    if (previous !== null && Math.abs(boundWidth - previous) < 2) {
        return null;
    }

    const ratio = boundWidth / viewportWidth;
    const scaled = ratio > 1 + SCALE_TOLERANCE || ratio < 1 - SCALE_TOLERANCE;

    // Mismatched units: re-express the width the renderer actually wants.
    // Same units: just top the window up to the smallest usable size.
    const target = scaled
        ? Math.round((MIN_CONTENT_WIDTH + 240) * ratio)
        : MIN_CONTENT_WIDTH + 240 + (boundWidth - viewportWidth);

    const clampedTarget = Math.min(Math.max(target, MIN_WIDTH), workArea.width);

    // Remember the width we are about to apply, so a second observation of the
    // same window is recognised as "already handled" instead of corrected again.
    lastAppliedContentWidth = clampedTarget;

    if (Math.abs(clampedTarget - boundWidth) < 2) {
        return null;
    }

    const currentHeight = Number.isFinite(bounds.height) ? bounds.height : MIN_HEIGHT;

    return {
        width: clampedTarget,
        // Keep the height, but never shrink below the minimum.
        height: Math.min(Math.max(currentHeight, MIN_HEIGHT), workArea.height),
    };
}

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
