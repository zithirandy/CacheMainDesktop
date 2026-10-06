/**
 * Read-only reconnaissance of the running app's DOM.
 *
 *   node tools/recon.mjs [debugPort] [urlFragment]
 *
 * Connects over the DevTools protocol and prints the interactive surface of the
 * current page: navigation, tabs, buttons, forms, selects, tables, modals.
 * Writes nothing and clicks nothing - it exists so tests stop guessing at
 * selectors.
 */

const port = process.argv[2] ?? '19233';
const targetFragment = process.argv[3] ?? null;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter(t => t.type === 'page');

if (pages.length === 0) {
    console.error('recon: no page targets');
    process.exit(1);
}

const target = targetFragment
    ? pages.find(p => p.url.includes(targetFragment)) ?? pages[0]
    : pages[0];

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
        setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 30_000);
    });
}

await send('Runtime.enable');

const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true});
    if (result.exceptionDetails) {
        return `ERR: ${result.exceptionDetails.exception?.description ?? 'eval failed'}`;
    }
    return result.result.value;
};

const report = await evaluate(`(() => {
    const clean = s => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    const out = {};

    out.url = location.href;
    out.title = document.title;

    // Safety guard: the connection list order decides the ?server= index, and
    // index 0 can point at a real remote database. Never dump key names read
    // from a non-loopback server - that is how a "read-only recon" leaks other
    // people's data. Only the server label and index are reported instead.
    const serverSelect = document.querySelector('#server_select');
    const selected = serverSelect?.selectedOptions?.[0]?.text ?? '';
    const pointsAtLoopback = /127\\.0\\.0\\.1|localhost/.test(selected);

    out.serverSelected = clean(selected);
    out.serverIsLoopback = pointsAtLoopback;

    if (!pointsAtLoopback && serverSelect) {
        out.GUARD = 'Non-loopback server selected: key names withheld. '
            + 'Re-run with an explicit ?server=<n> that points at 127.0.0.1.';
    }

    out.sidebarNav = [...document.querySelectorAll('aside a')]
        .map(a => ({text: clean(a.textContent), href: a.getAttribute('href')}));

    out.tabs = [...document.querySelectorAll('#pca_tabs a, [role="tab"], .tabs a')]
        .map(a => ({text: clean(a.textContent), href: a.getAttribute('href')}));

    out.buttons = [...document.querySelectorAll('button, input[type=submit], input[type=button]')]
        .map(b => ({text: clean(b.textContent || b.value), id: b.id || null,
                    name: b.getAttribute('name'), type: b.type,
                    cls: (b.className || '').toString().slice(0, 50)}));

    out.selects = [...document.querySelectorAll('select')].map(s => ({
        id: s.id || null, name: s.name || null,
        selected: s.options[s.selectedIndex] ? clean(s.options[s.selectedIndex].text) : null,
        options: [...s.options].map(o => clean(o.text))
    }));

    out.inputs = [...document.querySelectorAll('input, textarea')]
        .map(i => ({tag: i.tagName.toLowerCase(), id: i.id || null, name: i.name || null,
                    type: i.type || null, placeholder: i.placeholder || null,
                    value: (i.type === 'password' ? '(hidden)' : clean(i.value))}));

    out.links = [...document.querySelectorAll('a[href]')]
        .map(a => ({text: clean(a.textContent), href: a.getAttribute('href')}))
        .filter(a => a.text);

    out.tables = [...document.querySelectorAll('table')].map(t => ({
        headers: [...t.querySelectorAll('thead th')].map(th => clean(th.textContent)),
        rowCount: t.querySelectorAll('tbody tr').length
    }));

    out.forms = [...document.querySelectorAll('form')].map(f => ({
        id: f.id || null, action: f.getAttribute('action'),
        method: (f.getAttribute('method') || 'get').toUpperCase(),
        fields: [...f.querySelectorAll('input, select, textarea')]
            .map(i => i.name || i.id).filter(Boolean)
    }));

    // Withheld entirely for a non-loopback server: see the guard above.
    out.keyRows = pointsAtLoopback
        ? [...document.querySelectorAll('tbody tr')].slice(0, 40).map(tr => {
            const cells = [...tr.querySelectorAll('td')].map(td => clean(td.textContent));
            const cb = tr.querySelector('input[type=checkbox]');
            return {cells, hasCheckbox: !!cb,
                    checkboxValue: cb ? (cb.value || cb.getAttribute('data-key') || null) : null};
        })
        : [];

    out.headings = [...document.querySelectorAll('h1,h2,h3')].map(h => clean(h.textContent)).filter(Boolean);
    out.statusText = clean(document.querySelector('#status, .status, [role=status]')?.textContent);
    out.alerts = [...document.querySelectorAll('.alert, .pca-alert, [class*=alert]')].map(a => clean(a.textContent)).filter(Boolean);

    return out;
})()`);

if (typeof report === 'string') {
    console.log(report);
} else {
    console.log(JSON.stringify(report, null, 2));
}

socket.close();
process.exit(0);
