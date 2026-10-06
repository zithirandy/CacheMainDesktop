# CacheMainDesktop

A Windows desktop app for managing Redis and Memcached servers, wrapping
[phpCacheAdmin](https://github.com/RobiNN1/phpCacheAdmin) (v2.7.2, MIT) in an
Electron shell with a restyled sidebar UI.

```
Electron window ── http://127.0.0.1:<random port> ──> php/php.exe -S (bundled portable PHP 8.5 NTS)
                                                        └─ webapp/ (phpCacheAdmin fork, predis.phar)
```

- **Zero install for users**: ships its own PHP runtime; unzip and run.
- **Connections are managed in the app** (sidebar → Connections) and injected
  into the backend via `PCA_*` environment variables — the PHP core is
  essentially untouched.
- No login screen (the backend binds to `127.0.0.1` only, on a random port).
- Light/dark/system theme, single instance, remembers window geometry.

## Development

Requirements: Node.js, Windows.

```bash
npm install          # electron, electron-builder, tailwind CLI
npm run fetch-php    # download the portable PHP runtime (php/), sha256-checked
npm run build:css    # (re)build webapp/assets/css/styles.css from src.css
npm start            # launch the app
```

After editing Twig templates, clear the Twig cache (it is only auto-reloaded
in debug mode) **and** rebuild the CSS (new utility classes are generated
from the templates):

```bash
rm -rf webapp/tmp/twig && npm run build:css
```

### Tests

```bash
npm test             # unit tests (connections <-> env mapping, window state)
npm run smoke        # boots the real PHP backend headlessly and checks pages
```

### Package

```bash
npm run dist         # predist fetches PHP + builds CSS, then electron-builder
```

Output: `dist/CacheMainDesktop <version>.zip` — a portable folder with the
exe, `resources/php/` and `resources/webapp/`.

## Layout

| Path | Purpose |
|---|---|
| `main.mjs` | Electron main process: window, backend lifecycle, IPC |
| `preload.cjs` | Context-isolated bridge (`window.pcaDesktop`) |
| `lib/backend.js` | Spawn/ready/kill/restart of `php.exe -S` |
| `lib/connections.js` | connections.json ↔ `PCA_*` env mapping |
| `ui/` | Connection manager window (plain HTML/CSS/JS) |
| `webapp/` | phpCacheAdmin fork: sidebar `layout.twig`, desktop `src.css` layer, slim `config.php` |
| `scripts/` | fetch-php, icon generation, smoke/check helpers |
| `php/` | Bundled portable PHP (gitignored, downloaded on demand) |

## Notes

- The OPCache/APCu/Realpath dashboards are disabled in `webapp/config.php`:
  they introspect the PHP runtime they run inside (here: the bundled backend
  process), which says nothing about your production servers.
- Advanced connection options (`sentinels`, `nodes`, `ssl`, `path`, ...) are
  passed as JSON values; keys must not contain underscores (upstream
  `Config::envVarToArray` limitation).
- Changing connections restarts the PHP backend (takes ~a second); metrics
  and temp files live under `%APPDATA%/CacheMainDesktop`.
- The webapp keeps the upstream MIT license and attribution — see
  `webapp/LICENSE`.

## Security model

- The backend binds to `127.0.0.1` on a random port, refuses foreign
  `Origin`/`Host` headers (DNS-rebinding guard, `webapp/index.php`), and the
  Electron window never navigates away from it. Other local processes can
  still reach the port if they discover it - the same trust boundary as any
  other local dev tool.
- **Connection passwords are stored in plaintext** in
  `%APPDATA%/CacheMainDesktop/connections.json` (like most comparable tools;
  not DPAPI-encrypted). Treat the file like any other credentials file.
- The PHP runtime is pinned to an exact version; `fetch-php` fails the build
  when the pinned patch is no longer the newest of its series, so runtime
  changes are always a deliberate `PINNED_VERSION` bump.
- A crashed run can leave a php.exe behind only when the main process itself
  dies abnormally; the next start sweeps it via the recorded pid
  (`runtime.json`, image-name checked before kill).

## Running the check scripts against real servers

The browser-driven checks (`scripts/check-*.mjs`) accept LAN targets through
environment variables - no credentials live in this repo:

```bash
export PCA_TEST_REDIS_HOST=...      # defaults to 127.0.0.1
export PCA_TEST_REDIS_PASSWORD=...
export PCA_TEST_MC_HOST=...         # defaults to 127.0.0.1
export PCA_TEST_BROWSER=...         # chromium path override (auto-detected otherwise)
```

### Spinning up local test servers

`docker-compose.test.yml` starts a throwaway Redis and Memcached for exactly
this purpose. Both publish on `127.0.0.1` only and hold no persistent data:

```bash
docker compose -f docker-compose.test.yml up -d      # redis:6379, memcached:11211

bash scripts/test-redis-seed.sh                      # 9 keys across all types
python scripts/test-memcached-seed.py                # 5 keys + a TTL'd one
node scripts/check-live-servers.mjs                  # drives the dashboard against both

docker compose -f docker-compose.test.yml down       # throw it all away
```

The seed scripts exist so the dashboard has realistic data to render (sizes,
type badges, TTLs, sub-items) instead of an empty key list. `check-live-servers.mjs`
boots the bundled PHP backend, opens a real browser, and asserts the seeded keys
actually appear on the Redis and Memcached panels.

Notes from setting this up:

- The compose file starts Redis **without** a password. To exercise the auth
  path, run `docker compose -f docker-compose.test.yml exec redis redis-cli CONFIG SET requirepass localtest123`
  and export `PCA_TEST_REDIS_PASSWORD=localtest123` before the seed/check scripts.
  `CONFIG SET` is not persisted, so a restart returns to no-password.
- `REDIS_ARGS` is **not** honoured by the official `redis:8-alpine` image (its
  entrypoint execs `redis-server` directly), so extra flags must be passed as
  the container command, as this compose file does.
- Memcached runs with `-o track_sizes` so the per-item size distribution panel
  has data. The flag is silent in `stats`; verify with `stats sizes` once a key
  is stored.
- `scripts/test-redis-seed.sh` is LF-only by design (see `.gitattributes`);
  `core.autocrlf=true` would otherwise break its shebang outside Windows.

