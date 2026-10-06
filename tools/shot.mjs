/**
 * Capture properly framed screenshots of the running app.
 *
 *   node tools/shot.mjs --port 19233 --url "?dashboard=redis&server=3" --out shot.png [--full] [--wait 3000]
 *
 * Unlike `cdp.mjs --shot` (which grabs only the visible viewport), this passes
 * an explicit clip covering the whole document, so the captured image contains
 * the real content instead of whatever happens to be scrolled into view.
 *
 * --full   capture the entire scrollable document
 * --sel    capture just one element's box (CSS selector)
 */

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const port = arg('port', '19233');
const url = arg('url');
const out = arg('out');
const full = args.includes('--full');
const selector = arg('sel');
const waitMs = Number(arg('wait', '3000'));
const scrollTo = arg('scroll', null);

if (!out) {
    console.error('shot: --out <path> is required');
    process.exit(1);
}

const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page');
if (pages.length === 0) {
    console.error('shot: no page targets');
    process.exit(1);
}

const main = pages.find(p => p.url.startsWith('http://127.0.0.1:')) ?? pages[0];

const socket = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, {once: true});
    socket.addEventListener('error', () => reject(new Error('socket error')), {once: true});
});

let nextId = 1;
const pending = new Map();

socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) {
        pending.delete(message.id);
        message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
    }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
    setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 60_000);
});

await send('Page.enable');
await send('Runtime.enable');

if (url) {
    const base = main.url.split('?')[0];
    const target = url.startsWith('http') ? url : base + url;
    await send('Page.navigate', {url: target});
    await new Promise(r => setTimeout(r, waitMs));
}

if (scrollTo) {
    await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(scrollTo)});
            if (el) el.scrollIntoView({block: 'start'}); return !!el; })()`,
        returnByValue: true,
    });
    await new Promise(r => setTimeout(r, 800));
}

// Ask the page how big it really is, then clip to that.
const metrics = await send('Page.getLayoutMetrics');
const css = metrics.cssContentSize ?? metrics.contentSize;
console.log(`shot: content size ${Math.round(css.width)} x ${Math.round(css.height)}`);

let clip;

if (selector) {
    const box = await send('Runtime.evaluate', {
        expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height}; })()`,
        returnByValue: true,
    });

    const value = box.result?.value;
    if (!value) {
        console.error(`shot: selector not found: ${selector}`);
        process.exit(1);
    }

    clip = {x: value.x, y: value.y, width: value.width, height: value.height, scale: 1};
    console.log(`shot: element box ${Math.round(value.width)} x ${Math.round(value.height)}`);
} else if (full) {
    clip = {x: 0, y: 0, width: css.width, height: css.height, scale: 1};
}

const {data} = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    ...(clip ? {clip} : {}),
});

const {writeFile} = await import('node:fs/promises');
await writeFile(out, Buffer.from(data, 'base64'));
console.log(`shot: wrote ${out}`);
socket.close();
process.exit(0);
