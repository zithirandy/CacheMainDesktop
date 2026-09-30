/**
 * Dev-only: fill and save the first connection in the running Connection
 * manager, so the save -> backend-restart -> sidebar path can be verified.
 *
 *   node tools/fill-connection.mjs <port> <name> <host> <port>
 */

const [, , port = '19222', name = 'Local Redis', host = '127.0.0.1', cachePort = '6379'] = process.argv;

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find(page => page.url.includes('connections.html'));

if (!target) {
    console.error('fill-connection: the Connections window is not open');
    process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));

let nextId = 1;
const waiting = new Map();

socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const settle = waiting.get(message.id);
    if (settle) {
        waiting.delete(message.id);
        settle(message);
    }
});

const send = (method, params = {}) => new Promise(resolve => {
    const id = nextId++;
    waiting.set(id, resolve);
    socket.send(JSON.stringify({id, method, params}));
});

const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true});
    return result.result?.result?.value ?? result.result?.exceptionDetails?.exception?.description;
};

await send('Runtime.enable');

for (const [selector, value] of [['#f-name', name], ['#f-host', host], ['#f-port', cachePort]]) {
    console.log(selector, '->', await evaluate(`(() => {
        const field = document.querySelector(${JSON.stringify(selector)});
        if (!field) return 'missing';
        field.value = ${JSON.stringify(value)};
        field.dispatchEvent(new Event('input', {bubbles: true}));
        field.dispatchEvent(new Event('change', {bubbles: true}));
        return field.value;
    })()`));
}

console.log('apply ->', await evaluate(`(() => {
    const button = document.getElementById('editor-apply');
    if (!button) return 'no #editor-apply';
    button.click();
    return 'clicked';
})()`));

console.log('staged rows ->', await evaluate(`document.querySelectorAll('#list .conn').length`));
console.log('editor hidden ->', await evaluate(`document.getElementById('editor').classList.contains('hidden')`));
console.log('status ->', await evaluate(`document.getElementById('status').textContent`));

socket.close();
process.exit(0);
