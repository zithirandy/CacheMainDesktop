// Temporary electron-builder config used by scripts/build-offline.mjs.
//
// Mirrors electron-builder.yml but disables code signing / executable resource
// editing, which makes electron-builder fetch winCodeSign from GitHub. That
// download times out on restricted networks (connect ETIMEDOUT to
// 20.205.243.166) and aborts the whole build, even though signing is irrelevant
// for a locally-run portable build.
//
// extraResources is repeated verbatim: an earlier attempt passed
// `--config.extraResources=` to "undo" an override, which replaced the key with
// an empty value and silently bundled php/ and webapp/ INTO app.asar (40KB ->
// 143MB) instead of shipping them next to it.

export default {
    appId: 'com.zithirandy.cachemaindesktop',
    productName: 'CacheMainDesktop',
    copyright: 'MIT - webapp based on phpCacheAdmin by Róbert Kelčák',

    directories: {
        output: 'dist',
        buildResources: 'build',
    },

    files: [
        'main.mjs',
        'preload.cjs',
        'bootstrap.cjs',
        'lib/**',
        'ui/**',
        'package.json',
    ],

    extraResources: [
        {
            from: 'webapp',
            to: 'webapp',
            filter: ['**/*', '!tmp/**'],
        },
        {
            from: 'php',
            to: 'php',
        },
    ],

    win: {
        target: 'zip',
        icon: 'build/icon.png',
        signAndEditExecutable: false,
    },
};
