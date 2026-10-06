/**
 * Dev-only inspector (2026-10-06 correction round): screenshot the main window's
 * content area ONLY, cropping the sidebar (which lists existing connection
 * host:port — must never land in an image). Clip is computed live from the
 * sidebar's bounding rect, so it adapts to window size/theme.
 *
 *   node shot-content.mjs --port 19233 --out shot.png
 *
 * Not part of the app.
 */

const args = process.argv.slice(2);
const port = (i => i !== -1 && args[i + 1] ? args[i + 1] : '19233')(args.indexOf('--port'));
const out = (i => args[i + 1])(args.indexOf('--out'));

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find(t => t.type === 'page' && t.url.startsWith('http://127.0.0.1'));
if (!target) { console.error('no app page target'); process.exit(1); }
console.log(`target "${target.title}" ${target.url}`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
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
    setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method} timed out`)); }, 30_000);
});
await send('Runtime.enable');

const metrics = await send('Runtime.evaluate', {returnByValue: true, expression: `(() => {
    const side = document.querySelector('.pca-sidebar, aside, nav');
    const r = side ? side.getBoundingClientRect() : {width: 0, right: 0};
    return {sidebarRight: Math.ceil(r.right), sidebarW: Math.round(r.width),
            vw: window.innerWidth, vh: window.innerHeight};
})()`});
const m = metrics.result.value;
console.log(`viewport ${m.vw}x${m.vh}, sidebar width ${m.sidebarW} -> clipping from x=${m.sidebarRight}`);

const {data} = await send('Page.captureScreenshot', {
    format: 'png',
    clip: {x: m.sidebarRight, y: 0, width: Math.max(1, m.vw - m.sidebarRight), height: m.vh, scale: 1}
});
const {writeFile} = await import('node:fs/promises');
await writeFile(out, Buffer.from(data, 'base64'));
console.log(`wrote ${out}`);
socket.close();
process.exit(0);
