/**
 * TimelineRecorder: DevTools per-frame microtask / rAF timeline (coarse).
 *
 * Records, per render frame: the microtask effect-drain count + total effects
 * dequeued, and the rAF render-sweep duration. This is the data behind the
 * DevTools "Timeline" tab: the frame strip that shows effect work landing on
 * the microtask queue while the paint-aligned rAF sweep stays light.
 *
 * Discipline (this is the framework's hottest path):
 *   - Off by default. Engaged only by the DevTools hook (startTimelineRecording),
 *     i.e. when the panel opens.
 *   - The hot-path writers (EffectScheduler.flush, the rAF render callback) gate
 *     their calls behind `if (__DEV__ && recording)`. In production __DEV__ folds
 *     to false, the calls strip, the `recording` import goes unused, and this whole
 *     module is tree-shaken out; zero production footprint.
 *   - No per-frame allocation in steady state: the frame ring is preallocated on
 *     start and its records are overwritten in place.
 *
 * @module
 */

const _now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

// Live binding read by the hot-path call sites. ES module imports are live, so
// flipping it here is visible to importers with no function-call overhead.
export let recording = false;

let _frames = null;   // preallocated ring of frame records
let _max = 600;
let _head = 0;        // ring write cursor
let _count = 0;       // total frames recorded (drives frameNo + wrap detection)
let _drains = 0;      // flush() calls since the last finalized frame
let _effects = 0;     // effects dequeued since the last finalized frame
let _startT = 0;

/**
 * Begin recording. Preallocates the frame ring; safe to call repeatedly (resets).
 * @param {{maxFrames?: number}} [opts]
 */
export function startTimelineRecording(opts) {
    _max = Math.max(1, (opts && opts.maxFrames) || 600);
    _frames = new Array(_max);
    for (let i = 0; i < _max; i++) {
        _frames[i] = { frameNo: 0, t0: 0, drains: 0, effectCount: 0, rafMs: 0 };
    }
    _head = 0; _count = 0; _drains = 0; _effects = 0;
    _startT = _now();
    recording = true;
}

/**
 * Stop recording and return the frames in chronological order.
 * @returns {Array<{frameNo:number,t0:number,drains:number,effectCount:number,rafMs:number}>}
 */
export function stopTimelineRecording() {
    const out = _snapshot();
    recording = false;
    return out;
}

/** Snapshot the frames recorded so far without stopping (for live polling). */
export function getTimelineSnapshot() {
    return _snapshot();
}

/** @returns {boolean} whether recording is currently engaged. */
export function isTimelineRecording() {
    return recording;
}

// ── hot-path writers (only ever called inside `if (__DEV__ && recording)`) ──

/**
 * Note one microtask flush: +1 drain, +N effects dequeued this flush.
 * @param {number} effects
 */
export function timelineNoteFlush(effects) {
    _drains++;
    _effects += effects;
}

/**
 * Finalize the current frame at a rAF render boundary: store the microtask
 * counters accumulated since the previous frame plus this sweep's duration,
 * then reset the accumulators for the next frame.
 * @param {number} rafMs
 */
export function timelineNoteFrame(rafMs) {
    if (!_frames) return;
    const slot = _frames[_head];
    slot.frameNo = _count;
    slot.t0 = _now() - _startT;
    slot.drains = _drains;
    slot.effectCount = _effects;
    slot.rafMs = rafMs;
    _head = (_head + 1) % _max;
    _count++;
    _drains = 0;
    _effects = 0;
}

function _snapshot() {
    if (!_frames || _count === 0) return [];
    const n = Math.min(_count, _max);
    const out = new Array(n);
    // Oldest-first: once the ring has wrapped, the oldest record sits at _head.
    const start = _count > _max ? _head : 0;
    for (let i = 0; i < n; i++) {
        const f = _frames[(start + i) % _max];
        out[i] = { frameNo: f.frameNo, t0: f.t0, drains: f.drains, effectCount: f.effectCount, rafMs: f.rafMs };
    }
    return out;
}
