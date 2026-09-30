<?php // @formatter:off
/**
 * CacheMainDesktop default configuration.
 *
 * The desktop shell (Electron) injects the server list and the writable
 * directories through PCA_* environment variables at runtime, so this file
 * only carries the defaults for a standalone/dev run (php -S).
 *
 * Based on phpCacheAdmin (https://github.com/RobiNN1/phpCacheAdmin), MIT license.
 */

declare(strict_types=1);

return [
    // Server (local machine resources), Redis and Memcached. The OPCache/APCu/
    // Realpath dashboards introspect the PHP runtime they run in - which here
    // is the bundled backend process, not anything worth managing - so they
    // stay out of the desktop navigation.
    'dashboards' => [
        RobiNN\Pca\Dashboards\Server\ServerDashboard::class,
        RobiNN\Pca\Dashboards\Redis\RedisDashboard::class,
        RobiNN\Pca\Dashboards\Memcached\MemcachedDashboard::class,
    ],
    'redisoptions' => [
        'pubsubrefresh' => 5,
        'pubsubwindow'  => 5,
        'scanthreshold' => 100_000,
        // Always SCAN and cap the retrieved keys. The default KEY-based listing
        // pulls and sorts every key of the database in one go, which freezes
        // the UI on production servers with big keyspaces.
        'scansize' => 1000,
    ],
    // The connection list comes from the desktop shell via PCA_REDIS_* / PCA_MEMCACHED_* env variables.
    'redis'     => [],
    'memcached' => [],
    'apcu'      => [
        'separator' => ':',
    ],
    'opcache' => [],
    // Desktop app: no built-in login, the window is the entry point.
    'authusers'    => [],
    'authwarning'  => false,
    // Security
    'securityheaders' => true,
    // Decoding / Encoding
    'converters' => [
        'gzcompress' => [
            'view' => static fn (string $value): ?string => @gzuncompress($value) !== false ? gzuncompress($value) : null,
            'save' => static fn (string $value): string => gzcompress($value),
        ],
        'gzencode' => [
            'view' => static fn (string $value): ?string => @gzdecode($value) !== false ? gzdecode($value) : null,
            'save' => static fn (string $value): string => gzencode($value),
        ],
        'gzdeflate' => [
            'view' => static fn (string $value): ?string => @gzinflate($value) !== false ? gzinflate($value) : null,
            'save' => static fn (string $value): string => gzdeflate($value),
        ],
        'zlib' => [
            'view' => static fn (string $value): ?string => @zlib_decode($value) !== false ? zlib_decode($value) : null,
            'save' => static fn (string $value): string => zlib_encode($value, ZLIB_ENCODING_DEFLATE),
        ],
    ],
    // Formatting functions
    'formatters' => [
        'unserialize' => static function (string $value): ?string {
            $unserialized_value = @unserialize($value, ['allowed_classes' => false]);
            if ($unserialized_value !== false && is_array($unserialized_value)) {
                try {
                    return json_encode($unserialized_value, JSON_THROW_ON_ERROR);
                } catch (JsonException) {
                    return null;
                }
            }

            return null;
        },
    ],
    // Customizations
    'timeformat'   => 'Y-m-d H:i:s',
    // Chinese number conventions: dot decimals, comma thousands.
    'decimalsep'   => '.',
    'thousandssep' => ',',
    'listview'     => 'table',
    'keymodal'     => false, // Full-page key view - a modal is too cramped for editing.
    'sortthreshold' => 100_000,
    'panelrefresh'  => 30,
    'metricsrefresh' => 60,
    'metricstab'    => '1d',
    'liverefresh'   => 2,
    'metricsmaxage' => 30,
    'hash'          => 'cachedesktop',
    // Overridden by the desktop shell (PCA_TMPDIR / PCA_METRICSDIR / PCA_TWIGCACHE) to point at %APPDATA%.
    'tmpdir'     => __DIR__.'/tmp',
    'metricsdir' => __DIR__.'/tmp/metrics',
    'twigcache'  => __DIR__.'/tmp/twig',
];
