/**
 * Verify the O9 fix (large values must be capped and scroll) in the real app.
 *
 * The key-view markup is not reachable by simply requesting ?view=key - the app
 * redirects that back to the dashboard and loads details in a modal. So this
 * navigates the live keys page, finds the row for the given key, opens its
 * detail view the way a user does, and then measures the value box.
 *
 *   node scripts/check-big-value-collapse.mjs [debugPort] [phpPort] [serverIndex] [key]
 */

const debugPort = process.argv[2] ?? '19233';
const phpPort = process.argv[3] ?? '55162';
const serverIndex = process.argv[4] ?? '2';
const key = process.argv[5] ?? 'o9test';

const pages = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json())
    .filter(t => t.type === 'page');
const target = pages.find(p => p.url.startsWith('http://127.0.0.1:')) ?? pages[0];

if (!target) {
    console.error('check-big-value-collapse: no page target');
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
    setTimeout(() => pending.delete(id) && reject(new Error(`${method} timeout`)), 45_000);
});

const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');

// Land on the keys page for the target server.
await send('Page.navigate', {url: `http://127.0.0.1:${phpPort}/?dashboard=redis&server=${serverIndex}`});
await new Promise(r => setTimeout(r, 5000));

// Find the key's row, then open its detail view in-page (the app's own modal
// path), and measure the largest value box that appears.
const script = `
(async () => {
  const key = ${JSON.stringify(key)};
  const out = {url: location.href, found: false};

  const rowLink = [...document.querySelectorAll('a')]
    .find(a => (a.getAttribute('href') || '').includes('view=key') && a.textContent.trim() === key);

  out.found = !!rowLink;
  out.rowHref = rowLink ? rowLink.getAttribute('href') : null;

  if (!rowLink) {
    out.sampleKeys = [...document.querySelectorAll('a')]
      .map(a => (a.getAttribute('href') || ''))
      .filter(h => h.includes('view=key'))
      .slice(0, 5)
      .map(h => decodeURIComponent((h.match(/key=([^&]*)/) || [])[1] || ''));
    return JSON.stringify(out);
  }

  // Fetch the same URL the link points at, from inside the page so it shares
  // the session, then measure the injected markup.
  const res = await fetch(rowLink.href);
  const html = await res.text();
  out.detailStatus = res.status;
  out.detailLen = html.length;
  out.detailHasMaxH96 = html.includes('max-h-96');

  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);

  const boxes = [...holder.querySelectorAll('.overflow-auto')];
  const big = boxes
    .map(el => ({el, len: el.textContent.length}))
    .sort((a, b) => b.len - a.len)[0];

  if (big) {
    const style = getComputedStyle(big.el);
    out.valueBox = {
      contentLength: big.len,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      whiteSpace: style.whiteSpace,
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      clientHeight: big.el.clientHeight,
      scrollHeight: big.el.scrollHeight,
      clientWidth: big.el.clientWidth,
      scrollWidth: big.el.scrollWidth,
      verticalScroll: big.el.scrollHeight > big.el.clientHeight,
      horizontalScroll: big.el.scrollWidth > big.el.clientWidth,
    };
  }

  holder.remove();
  return JSON.stringify(out);
})()
`;

const report = JSON.parse(await evaluate(script));
console.log(JSON.stringify(report, null, 2));

const box = report.valueBox;

if (!report.found || !box) {
    console.log('\nFAIL: could not reach the key detail view for this key');
    socket.close();
    process.exit(1);
}

// Two independent properties matter for a large value:
//   - it must be height-capped (the original O9 report), and
//   - it must WRAP, otherwise a 100KB unbroken string is a single line that the
//     box scrolls sideways forever, which is just as unusable.
const capped = box.maxHeight && box.maxHeight !== 'none';
const scrolls = box.verticalScroll || box.horizontalScroll;
const wraps = box.overflowWrap === 'anywhere' || box.wordBreak === 'break-word'
    || box.wordBreak === 'break-all' || box.whiteSpace.startsWith('pre-wrap');

console.log('');
console.log(`  ${capped ? 'ok  ' : 'FAIL'}  value box is height-capped (max-height ${box.maxHeight})`);
console.log(`  ${wraps ? 'ok  ' : 'FAIL'}  long value wraps instead of scrolling sideways (overflow-wrap: ${box.overflowWrap})`);
console.log(`  ${scrolls ? 'ok  ' : 'FAIL'}  oversized content scrolls inside the box rather than stretching the page`);

socket.close();
process.exit(capped && wraps ? 0 : 1);
