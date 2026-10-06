/**
 * Dev-only inspector (same family as tools/cdp.mjs): drive a running
 * CacheMainDesktop window over the DevTools protocol with an ordered list
 * of actions from a UTF-8 JSON file, so non-ASCII field values never touch
 * the command line.
 *
 *   node tools/cdp-form.mjs --port 19233 [--target urlFragment] --file actions.json
 *
 * Action objects, executed in array order:
 *   {"set": {"sel": "#f-name", "val": "本地 Redis"}}   set input/select/textarea
 *                                                      (+ input & change events)
 *   {"click": "#add"}                                  click by CSS selector
 *   {"clickText": "New"}                               click first button/a/li/... whose
 *                                                      text contains the string
 *   {"wait": 1500}                                     sleep ms
 *   {"readText": "#status"}                            print an element's textContent
 *   {"readValue": "#f-name"}                           print a field's current value
 *   {"count": "#list .conn"}                           print a selector match count
 *   {"dumpText": true}                                 print document.body.innerText
 *   {"nav": "http://..."}                              Page.navigate
 *   {"shot": "out.png"}                                full-page screenshot
 *   {"shotSel": "#editor"}                             screenshot clipped to element
 *                                                      (scrolls it into view first)
 */

import {writeFile} from 'node:fs/promises';

const args = process.argv.slice(2);

function arg(name, fallback = null) {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const port = arg('port', '19222');
const targetUrl = arg('target', null);
const actionFile = arg('file');

if (!actionFile) {
    console.error('cdp-form: --file <actions.json> is required');
    process.exit(2);
}

const actions = JSON.parse(await (await import('node:fs/promises')).readFile(actionFile, 'utf8'));

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pages = list.filter(t => t.type === 'page');

if (pages.length === 0) {
    console.error('cdp-form: no page targets');
    process.exit(1);
}

const target = targetUrl ? pages.find(p => p.url.includes(targetUrl)) ?? pages[0] : pages[0];
console.log(`cdp-form: target "${target.title}" ${target.url}`);

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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

for (const [index, action] of actions.entries()) {
    if (action.wait !== undefined) {
        console.log(`[${index}] wait ${action.wait}ms`);
        await sleep(action.wait);
    } else if (action.set) {
        const value = await evaluate(`(() => {
            const field = document.querySelector(${JSON.stringify(action.set.sel)});
            if (!field) return 'missing';
            field.value = ${JSON.stringify(action.set.val)};
            field.dispatchEvent(new Event('input', {bubbles: true}));
            field.dispatchEvent(new Event('change', {bubbles: true}));
            return String(field.value);
        })()`);
        console.log(`[${index}] set ${action.set.sel} -> ${JSON.stringify(value)}`);
    } else if (action.click) {
        const result = await evaluate(`(() => {
            const hit = document.querySelector(${JSON.stringify(action.click)});
            if (!hit) return 'not found';
            hit.click();
            return 'clicked';
        })()`);
        console.log(`[${index}] click ${action.click} -> ${result}`);
        await sleep(400);
    } else if (action.clickText) {
        const result = await evaluate(`(() => {
            const wanted = ${JSON.stringify(action.clickText)};
            const nodes = [...document.querySelectorAll('button, a, [role="button"], li, summary')];
            const hit = nodes.find(n => (n.textContent || '').trim().includes(wanted));
            if (!hit) return 'not found: ' + nodes.map(n => (n.textContent || '').trim()).filter(Boolean).join(' | ').slice(0, 400);
            hit.click();
            return 'clicked';
        })()`);
        console.log(`[${index}] clickText ${JSON.stringify(action.clickText)} -> ${result}`);
        await sleep(400);
    } else if (action.readText) {
        const value = await evaluate(`document.querySelector(${JSON.stringify(action.readText)})?.textContent ?? 'missing'`);
        console.log(`[${index}] readText ${action.readText} -> ${JSON.stringify(value.trim())}`);
    } else if (action.readValue) {
        const value = await evaluate(`document.querySelector(${JSON.stringify(action.readValue)})?.value ?? 'missing'`);
        console.log(`[${index}] readValue ${action.readValue} -> ${JSON.stringify(String(value))}`);
    } else if (action.count) {
        const value = await evaluate(`document.querySelectorAll(${JSON.stringify(action.count)}).length`);
        console.log(`[${index}] count ${action.count} -> ${value}`);
    } else if (action.readExpr) {
        const value = await evaluate(action.readExpr);
        console.log(`[${index}] readExpr ${action.readExpr.slice(0, 100)} -> ${JSON.stringify(value)}`);
    } else if (action.dumpText) {
        const text = await evaluate('document.body.innerText');
        console.log(`[${index}] --- body.innerText start ---\n${text}\n[${index}] --- body.innerText end ---`);
    } else if (action.nav) {
        await send('Page.navigate', {url: action.nav});
        console.log(`[${index}] nav -> ${action.nav}`);
        await sleep(1500);
    } else if (action.shot || action.shotSel) {
        let clip;

        if (action.shotRect) {
            const {data} = await send('Page.captureScreenshot', {format: 'png', clip: {...action.shotRect, scale: 1}});
            await writeFile(action.shot, Buffer.from(data, 'base64'));
            console.log(`[${index}] shot -> ${action.shot} (rect ${JSON.stringify(action.shotRect)})`);
        } else if (action.shotSel) {
            const selectors = Array.isArray(action.shotSel) ? action.shotSel : [action.shotSel];
            const box = await evaluate(`(() => {
                const els = ${JSON.stringify(selectors)}
                    .map(sel => document.querySelector(sel))
                    .filter(Boolean);
                if (els.length === 0) return null;
                els[0].scrollIntoView({block: 'center'});
                const rects = els.map(el => el.getBoundingClientRect());
                const x = Math.min(...rects.map(r => r.x));
                const y = Math.min(...rects.map(r => r.y));
                const right = Math.max(...rects.map(r => r.right));
                const bottom = Math.max(...rects.map(r => r.bottom));
                return {x, y, width: right - x, height: bottom - y, scale: 1};
            })()`);
            if (!box) {
                console.log(`[${index}] shotSel ${action.shotSel} -> element missing, skipped`);
                continue;
            }
            clip = box;
        }

        const {data} = await send('Page.captureScreenshot', {format: 'png', ...(clip ? {clip} : {})});
        const path = action.shot ?? action.shotSel.replace(/[^a-z0-9]+/gi, '-') + '.png';
        await writeFile(action.shot ?? path, Buffer.from(data, 'base64'));
        console.log(`[${index}] shot -> ${action.shot ?? path}${clip ? ` (clipped to ${action.shotSel})` : ''}`);
    } else {
        console.log(`[${index}] unknown action, skipped: ${JSON.stringify(action).slice(0, 120)}`);
    }
}

socket.close();
process.exit(0);
