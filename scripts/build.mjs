/**
 * Wrapper around electron-builder that pins the binaries mirror.
 *
 * electron-builder fetches winCodeSign/nsis from GitHub releases, which can
 * be unreachable behind some networks; npmmirror hosts the same artifacts.
 * Set ELECTRON_BUILDER_BINARIES_MIRROR to override.
 */

import {spawn} from 'node:child_process';

process.env.ELECTRON_BUILDER_BINARIES_MIRROR ??= 'https://npmmirror.com/mirrors/electron-builder-binaries/';

// Node >= 18.20 refuses to spawn .cmd/.bat directly (EINVAL); run npx
// through the shell instead - the argument list here is fixed and simple.
const child = spawn('npx', ['electron-builder', ...process.argv.slice(2)],
    {stdio: 'inherit', env: process.env, shell: true});

child.on('exit', code => process.exit(code ?? 1));
