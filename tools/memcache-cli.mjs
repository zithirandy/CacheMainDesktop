/**
 * Dev-only READ-ONLY memcached text-protocol client for test verification.
 *
 *   node tools/memcache-cli.mjs keys [port]
 *   node tools/memcache-cli.mjs get <key> [port]
 *   node tools/memcache-cli.mjs stats [port]
 *
 * Deliberately has no set/delete: it exists so tests can independently
 * verify what the UI did to the backend, without becoming a second writer.
 */

import net from 'node:net';

const [cmd, key, portArg] = process.argv.slice(2);
const port = Number(portArg ?? 11211);

if (!['keys', 'get', 'stats'].includes(cmd)) {
    console.error('usage: memcache-cli.mjs keys|get <key>|stats [port]');
    process.exit(2);
}

const socket = net.connect(port, '127.0.0.1');
let buffer = '';

const command = cmd === 'keys'
    ? 'lru_crawler metadump all\r\n'
    : cmd === 'get' ? `get ${key}\r\n`
    : 'stats\r\n';

socket.on('connect', () => socket.write(command));
socket.on('data', chunk => {
    buffer += chunk.toString('utf8');
    if (buffer.includes('END\r\n') || buffer.includes('ERROR\r\n') || /STAT \d+/.test(buffer) && cmd === 'keys' && buffer.endsWith('\r\n') && !buffer.startsWith('STAT')) {
        // metadump ends with "END"; get ends with "END"; stats never ends - close after a beat
        if (cmd !== 'stats') socket.end();
    }
});

setTimeout(() => socket.end(), cmd === 'stats' ? 800 : 3000);

socket.on('close', () => {
    const lines = buffer.split('\r\n').filter(Boolean);
    if (cmd === 'keys') {
        for (const line of lines) {
            if (line.startsWith('key=')) console.log(line);
        }
    } else {
        console.log(buffer.trimEnd());
    }
    process.exit(0);
});

socket.on('error', err => {
    console.error(`memcache-cli: ${err.message}`);
    process.exit(1);
});
