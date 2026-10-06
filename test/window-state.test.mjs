import {strict as assert} from 'node:assert';
import {beforeEach, describe, it} from 'node:test';

import {clampToScreen, correctionForUsableContent, defaultState, resetClampMemo} from '../lib/window-state.js';

// A typical single-display setup: one 2560x1440 screen at origin (0, 0).
const DISPLAYS = [{x: 0, y: 0, width: 2560, height: 1440}];

describe('defaultState', () => {
    it('has a sensible desktop size', () => {
        const state = defaultState();
        assert.ok(state.width >= 1100);
        assert.ok(state.height >= 700);
    });
});

describe('clampToScreen', () => {
    it('keeps an on-screen state untouched', () => {
        const state = {x: 100, y: 100, width: 1280, height: 800};
        assert.deepEqual(clampToScreen(state, DISPLAYS), state);
    });

    it('moves a window that is fully off-screen back onto the primary display', () => {
        const state = {x: -5000, y: -3000, width: 1280, height: 800};
        const clamped = clampToScreen(state, DISPLAYS);
        assert.ok(clamped.x >= 0 && clamped.x < DISPLAYS[0].width);
        assert.ok(clamped.y >= 0 && clamped.y < DISPLAYS[0].height);
    });

    it('handles a display that disappeared between runs', () => {
        // Window was on a second monitor at x=3000 that no longer exists.
        const clamped = clampToScreen({x: 3000, y: 200, width: 1280, height: 800}, DISPLAYS);
        assert.ok(clamped.x < DISPLAYS[0].width);
    });

    it('rejects absurd window sizes', () => {
        const clamped = clampToScreen({x: 10, y: 10, width: 20000, height: 12000}, DISPLAYS);
        assert.ok(clamped.width <= DISPLAYS[0].width);
        assert.ok(clamped.height <= DISPLAYS[0].height);
    });

    it('falls back to the default for an empty display list', () => {
        const clamped = clampToScreen({x: 50, y: 50, width: 1280, height: 800}, []);
        assert.deepEqual(clamped, defaultState());
    });
});

// Regression cover for defect D5: a restored geometry can still leave the main
// content area (window width minus the 240px sidebar) unusable, which is what
// happened when a window-state.json from another display configuration was
// applied verbatim - the key list collapsed to ~339px.
describe('correctionForUsableContent', () => {
    const WORK_AREA = {x: 0, y: 0, width: 2880, height: 1704};

    beforeEach(() => resetClampMemo());

    it('leaves a healthy window alone', () => {
        const bounds = {width: 1280, height: 800};
        const viewport = {width: 1264, height: 720};

        assert.equal(correctionForUsableContent(bounds, viewport, WORK_AREA), null);
    });

    it('undoes a unit mismatch that squeezed the content area', () => {
        // The reported case: 1289px of window produced a 607px viewport, so the
        // content area was only ~339px after the sidebar.
        const bounds = {width: 1289, height: 842};
        const viewport = {width: 607, height: 685};

        const fix = correctionForUsableContent(bounds, viewport, WORK_AREA);

        assert.ok(fix, 'expected a correction');
        // ratio ~2.12 -> target ~(840 * 2.12) = ~1782, which leaves >=600px of content.
        assert.ok(fix.width > bounds.width, `expected a wider window, got ${fix.width}`);
        assert.ok(fix.width <= WORK_AREA.width);
    });

    it('tops up a genuinely narrow window when the units agree', () => {
        const bounds = {width: 700, height: 600};
        const viewport = {width: 684, height: 540};

        const fix = correctionForUsableContent(bounds, viewport, WORK_AREA);

        assert.ok(fix, 'expected a correction');
        // Same units: grow by the shortfall, but never below the window minimum.
        const shortfallTarget = 700 + (600 - (684 - 240));   // 856
        assert.equal(fix.width, Math.max(shortfallTarget, 900));
        assert.equal(fix.height, 600);
        // Whatever it picks, the content area must end up usable.
        assert.ok(fix.width - 240 >= 600, `content area too small: ${fix.width - 240}`);
    });

    it('does not fight a display that simply cannot fit the minimum', () => {
        const small = {x: 0, y: 0, width: 640, height: 480};
        const bounds = {width: 400, height: 300};
        const viewport = {width: 384, height: 240};

        const fix = correctionForUsableContent(bounds, viewport, small);

        assert.ok(fix);
        assert.equal(fix.width, small.width);
    });

    it('gives up after one correction instead of looping', () => {
        const bounds = {width: 1289, height: 842};
        const viewport = {width: 607, height: 685};

        const fix = correctionForUsableContent(bounds, viewport, WORK_AREA);
        assert.ok(fix, 'expected a correction');

        // The window is now at the corrected width but the viewport is still
        // reported narrow (a stubborn display); a second pass must stand down
        // rather than keep growing the window forever.
        const second = correctionForUsableContent({width: fix.width, height: 842}, viewport, WORK_AREA);
        assert.equal(second, null);
    });

    it('ignores nonsense input rather than throwing', () => {
        assert.equal(correctionForUsableContent(null, {width: 800}, WORK_AREA), null);
        assert.equal(correctionForUsableContent({width: 800}, null, WORK_AREA), null);
        assert.equal(correctionForUsableContent({width: 800}, {width: 800}, null), null);
        assert.equal(correctionForUsableContent({width: 800}, {width: 0}, WORK_AREA), null);
        assert.equal(correctionForUsableContent({width: NaN}, {width: 800}, WORK_AREA), null);
    });
});
