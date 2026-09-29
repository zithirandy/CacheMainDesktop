<?php
/**
 * CacheMainDesktop web entry.
 *
 * Based on the phpCacheAdmin entry point (https://github.com/RobiNN1/phpCacheAdmin), MIT license.
 * Desktop adaptation: no built-in auth, the Electron window is the entry point and
 * the server list arrives through PCA_* environment variables.
 */

declare(strict_types=1);

ini_set('display_errors', 'Off');
ini_set('display_startup_errors', 'Off');
error_reporting(E_ALL);

/**
 * Desktop shell guard: the backend answers on 127.0.0.1 only, but a page on
 * another origin (classic DNS-rebinding: attacker domain resolves to
 * 127.0.0.1) is still "same-origin" to the browser and could read the AJAX
 * endpoints. Browsers attach an Origin header to such cross-origin fetches,
 * and the shell never sends one, so anything with a foreign Origin - or a
 * Host header that is not this exact loopback endpoint - is refused.
 */
(function (): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';

    if ($origin !== '' && !str_starts_with($origin, 'http://127.0.0.1:') && !str_starts_with($origin, 'http://localhost:')) {
        http_response_code(403);
        exit('Forbidden.');
    }

    $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));

    if (!preg_match('~^127\.0\.0\.1:\d+$~', $host) && !preg_match('~^localhost:\d+$~', $host)) {
        http_response_code(403);
        exit('Forbidden.');
    }
})();

if (getenv('PCA_PHP_MEMORY_LIMIT')) {
    ini_set('memory_limit', getenv('PCA_PHP_MEMORY_LIMIT'));
}

$path = __DIR__.'/';

if (is_file(__DIR__.'/vendor/autoload.php')) {
    require_once __DIR__.'/vendor/autoload.php';

    if (!extension_loaded('redis') &&
        Composer\InstalledVersions::isInstalled('predis/predis') === false &&
        is_file($path.'predis.phar')
    ) {
        require_once 'phar://'.$path.'predis.phar/vendor/autoload.php';
    }
} else {
    require_once __DIR__.'/src/functions.php';
    autoload($path);
}

RobiNN\Pca\Config::loadDotenv($path);

if (RobiNN\Pca\Config::get('debug', false)) {
    ini_set('display_errors', 'On');
    ini_set('display_startup_errors', 'On');
}

echo (new RobiNN\Pca\Admin())->render();
