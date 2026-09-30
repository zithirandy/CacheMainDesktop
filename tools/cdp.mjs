/**
 * Dev-only inspector: talk to a running CacheMainDesktop (or any Chromium page)
 * over the DevTools protocol to screenshot it or click an element.
 *
 *   node tools/cdp.mjs --port 19222 --shot out.png
 *   node tools/cdp.mjs --port 19222 --text "Connections" --shot out.png
 *   node tools/cdp.mjs --port 19222 --click "[data-pca-connections]"
 *
 * Not part of the app: it exists so the shell can be verified without hands on
 * a mouse. Delete it if you do not want it in the repo.
 */

const args = process.argv.slice(2);

function arg(name, fallback = null) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const port = arg('port', '19222');
const targetUrl = arg('target', null);
const shot = arg('shot');
const clickSel = arg('click');
const textToClick = arg('text');
const dump = args.includes('--dump');

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter(t => t.type === 'page');

if (pages.length === 0) {
    console.error('cdp: no page targets');
    process.exit(1);
}

const target = targetUrl ? pages.find(p => p.url.includes(targetUrl)) ?? pages[0] : pages[0];
console.log(`cdp: target "${target.title}" ${target.url}`);

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

function send(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, {resolve, reject});
        socket.send(JSON.stringify({id, method, params}));
        setTimeout(() => {
            if (pending.delete(id)) {
                reject(new Error(`${method} timed out`));
            }
        }, 30_000);
    });
}

await send('Runtime.enable');
await send('Page.enable');

const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
};

if (textToClick) {
    const clicked = await evaluate(`(() => {
        const wanted = ${JSON.stringify(textToClick)};
        const nodes = [...document.querySelectorAll('button, a, [role="button"], li, summary')];
        const hit = nodes.find(n => (n.textContent || '').trim().includes(wanted));
        if (!hit) return 'not found: ' + nodes.map(n => (n.textContent || '').trim()).filter(Boolean).join(' | ').slice(0, 400);
        hit.click();
        return 'clicked';
    })()`);
    console.log(`cdp: click by text -> ${clicked}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
}

if (clickSel) {
    const clicked = await evaluate(`(() => {
        const hit = document.querySelector(${JSON.stringify(clickSel)});
        if (!hit) return 'not found';
        hit.click();
        return 'clicked';
    })()`);
    console.log(`cdp: click ${clickSel} -> ${clicked}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
}

if (dump) {
    const html = await evaluate('document.documentElement.outerHTML');
    console.log(html.slice(0, 4000));
}

if (shot) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    const {writeFile} = await import('node:fs/promises');
    await writeFile(shot, Buffer.from(data, 'base64'));
    console.log(`cdp: wrote ${shot}`);
}

socket.close();
process.exit(0);
