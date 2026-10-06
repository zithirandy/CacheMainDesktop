/**
 * Verify defect D3's fix: importing a malformed file must tell the user what
 * went wrong instead of reloading the page in silence.
 *
 * The alert markup is injected into the page by script (layout.twig ships an
 * empty #alerts container), so this checks the live DOM in a real browser
 * rather than grepping the HTML response.
 *
 *   node scripts/check-import-feedback.mjs [debugPort] [phpPort] [serverIndex]
 */

const debugPort = process.argv[2] ?? '19233';
const phpPort = process.argv[3] ?? '54951';
const serverIndex = process.argv[4] ?? '3';

const pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json())
    .filter(t => t.type === 'page');
const target = pages.find(p => p.url.startsWith('http://127.0.0.1:')) ?? pages[0];

if (!target) {
    console.error('check-import-feedback: no page target');
    process.exit(1);
}

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
    setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 40_000);
});

await send('Page.enable');
await send('Runtime.enable');

// Navigate first, in its own step: doing it inside the evaluated script tears
// down the execution context the evaluate is running in.
await send('Page.navigate', {url: `http://127.0.0.1:${phpPort}/?dashboard=redis&server=${serverIndex}`});
await new Promise(r => setTimeout(r, 4000));

// Post a malformed file through the real form, then read whatever the app tells
// the user. The alert markup is injected by script, so this must run in the page.
const script = `
(async () => {
  const origin = location.origin;
  const keysUrl = origin + '/?dashboard=redis&server=${serverIndex}';
  const out = {steps: []};

  const csrf = (document.querySelector('input[name=csrf_token]') || {}).value;
  out.steps.push('csrf=' + (csrf ? 'yes' : 'NO'));

  const send = async (content, filename) => {
    const form = new FormData();
    form.set('csrf_token', csrf);
    form.set('submit_import_key', '1');
    form.set('import', new File([content], filename, {type: 'application/json'}));
    const r = await fetch(keysUrl, {method: 'POST', body: form, redirect: 'follow'});
    await new Promise(res => setTimeout(res, 2500));
    const alerts = [...document.querySelectorAll('#alerts .py-3, #alerts > div')]
      .map(el => el.textContent.replace(/\\s+/g, ' ').trim())
      .filter(Boolean);
    return {status: r.status, alerts};
  };

  out.malformed = await send('this is definitely not json {{{', 'broken.json');
  out.notAnArray = await send(JSON.stringify({nope: true}), 'object.json');
  out.validButEmpty = await send('[]', 'empty.json');

  return JSON.stringify(out, null, 1);
})()
`;

const response = await send('Runtime.evaluate', {expression: script, returnByValue: true, awaitPromise: true});

if (response.exceptionDetails) {
    console.error('eval failed:', response.exceptionDetails.exception?.description);
    process.exit(1);
}

const report = JSON.parse(response.result.value);
console.log(JSON.stringify(report, null, 2));

const all = [
    ...(report.malformed?.alerts ?? []),
    ...(report.notAnArray?.alerts ?? []),
    ...(report.validButEmpty?.alerts ?? []),
].join(' | ');

const checks = [
    ['malformed file is reported', /not valid JSON/i.test(all)],
    ['non-array file is reported', /does not contain a list/i.test(all)],
    ['empty file is reported', /no keys to import/i.test(all)],
];

let failed = 0;

for (const [name, ok] of checks) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    failed += ok ? 0 : 1;
}

console.log(`\n${failed === 0
    ? 'PASS: every rejected import produces a visible message'
    : `${failed} check(s) failed`}`);

socket.close();
process.exit(failed === 0 ? 0 : 1);
