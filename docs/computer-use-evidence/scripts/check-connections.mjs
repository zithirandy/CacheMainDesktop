// Ground-truth check of connections.json: count, per-type counts, presence
// of the two test names. Never prints hosts, usernames or passwords.
import {readFile} from 'node:fs/promises';
import path from 'node:path';

const file = path.join(process.env.APPDATA, 'CacheMainDesktop', 'connections.json');
const list = JSON.parse(await readFile(file, 'utf8'));

const names = list.map(c => c.name ?? '(unnamed)');
console.log('total records:', list.length);
console.log('types:', list.map(c => c.type).join(', '));
console.log('has "本地 Redis":', names.includes('本地 Redis'));
console.log('has "本地 Memcached":', names.includes('本地 Memcached'));
const mine = list.filter(c => c.name === '本地 Redis' || c.name === '本地 Memcached');
for (const c of mine) {
    console.log(`mine: name=${c.name} type=${c.type} host=${c.host} port=${c.port} db=${c.database ?? '-'} user=${JSON.stringify(c.username ?? null)} pw=${c.password ? '(set)' : '(empty)'}`);
}
