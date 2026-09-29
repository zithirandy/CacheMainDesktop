import {strict as assert} from 'node:assert';
import {describe, it} from 'node:test';

import {clampToScreen, defaultState} from '../lib/window-state.js';

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
