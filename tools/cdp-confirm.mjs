/**
 * Dev-only inspector (same family as tools/cdp.mjs): click an element that
 * triggers a native window.confirm()/alert(), capture the dialog text via
 * Page.javascriptDialogOpening, answer it, and report where the page ended up.
 *
 *   node tools/cdp-confirm.mjs --port 19233 --click "a[href*=delete]" --dialog accept
 *
 * --dialog accept|dismiss   how to answer the dialog (default dismiss = safe)
 * --shot out.png             screenshot after settling
 * --wait 2000                settle time after dialog (default 2000)
 *
 * Without --click it just waits for a dialog for --timeout ms (default 15000).
 */

const args = process.argv.slice(2);

function arg(name, fallback = null) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const port = arg('port', '19233');
const targetUrl = arg('target', null);
const clickSel = arg('click');
const dialogAnswer = arg('dialog', 'dismiss') === 'accept';
const shot = arg('shot');
const settle = Number(arg('wait', '2000'));
const timeout = Number(arg('timeout', '15000'));

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter(t => t.type === 'page');

if (pages.length === 0) {
    console.error('cdp-confirm: no page targets');
    process.exit(1);
}

const target = targetUrl ? pages.find(p => p.url.includes(targetUrl)) ?? pages[0] : pages[0];
console.log(`cdp-confirm: target "${target.title}" ${target.url}`);

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
        }, timeout);
    });
}

const dialogLog = [];

socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Page.javascriptDialogOpening') {
        const {type, message: text, url} = message.params;
        dialogLog.push({type, text, url});
        console.log(`cdp-confirm: DIALOG ${type} @ ${url}`);
        console.log(`cdp-confirm: DIALOG TEXT: ${JSON.stringify(text)}`);
        send('Page.handleJavaScriptDialog', {accept: dialogAnswer})
            .then(() => console.log(`cdp-confirm: answered ${dialogAnswer ? 'accept' : 'dismiss'}`))
            .catch(err => console.log(`cdp-confirm: handle failed: ${err.message}`));
    }
});

await send('Runtime.enable');
await send('Page.enable');

const started = Date.now();

if (clickSel) {
    const clicked = await send('Runtime.evaluate', {
        expression: `(() => {
            const hit = document.querySelector(${JSON.stringify(clickSel)});
            if (!hit) return 'not found';
            hit.click();
            return 'clicked';
        })()`,
        returnByValue: true,
    }).then(r => r.result.value).catch(err => `click failed: ${err.message}`);
    console.log(`cdp-confirm: click ${clickSel} -> ${clicked}`);
}

// Wait out the settle time so navigation triggered by the dialog answer completes.
const deadline = started + settle + 1000;
while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
}

const finalUrl = await send('Runtime.evaluate', {expression: 'location.search', returnByValue: true})
    .then(r => r.result.value).catch(() => '(page busy)');
console.log(`cdp-confirm: final URL query: ${finalUrl}`);
console.log(`cdp-confirm: dialogs seen: ${dialogLog.length}`);

if (shot) {
    const {data} = await send('Page.captureScreenshot', {format: 'png'});
    const {writeFile} = await import('node:fs/promises');
    await writeFile(shot, Buffer.from(data, 'base64'));
    console.log(`cdp-confirm: wrote ${shot}`);
}

socket.close();
process.exit(0);
