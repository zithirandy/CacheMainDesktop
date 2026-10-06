/**
 * Dev-only inspector (2026-10-06 correction round): dump UI facts from a running
 * CacheMainDesktop over DevTools — sidebar nav links, the desktop Connections
 * button, every <select> with its selected option, and visible buttons.
 *
 *   node ui-dump.mjs --port 19233
 *
 * Not part of the app. Output is JSON on stdout; curate+redact before keeping.
 */

const args = process.argv.slice(2);
const i = args.indexOf('--port');
const port = i !== -1 && args[i + 1] ? args[i + 1] : '19233';

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter(t => t.type === 'page');
console.error(`targets: ${pages.map(p => `"${p.title}"`).join(', ')}`);

const collector = `(() => {
    const r = {title: document.title, url: location.href};
    r.navLinks = [...document.querySelectorAll('a')].map(a => ({
        t: (a.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        href: a.getAttribute('href')
    })).filter(x => x.t);
    const conn = document.querySelector('[data-pca-connections]');
    r.connectionsButton = conn ? {
        tag: conn.tagName,
        text: (conn.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        visible: !!conn.offsetParent
    } : null;
    r.selects = [...document.querySelectorAll('select')].map(s => ({
        id: s.id,
        name: s.name,
        selectedIndex: s.selectedIndex,
        options: [...s.options].map(o => ({v: o.value, t: (o.textContent || '').trim()}))
    }));
    r.buttons = [...document.querySelectorAll('button, [role="button"]')]
        .map(b => (b.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40))
        .filter(Boolean).slice(0, 40);
    return r;
})()`;

for (const target of pages) {
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
    const result = await send('Runtime.evaluate', {expression: collector, returnByValue: true});
    socket.close();
    if (result.exceptionDetails) {
        console.error(`evaluate failed on "${target.title}": ${result.exceptionDetails.exception?.description}`);
        continue;
    }
    console.log(`===== PAGE "${target.title}" =====`);
    console.log(JSON.stringify(result.result.value, null, 1));
}
process.exit(0);
