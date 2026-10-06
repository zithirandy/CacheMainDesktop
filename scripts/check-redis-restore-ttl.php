<?php
/**
 * Direct test of the Redis import path that defect D2 was reported against.
 *
 * It drives the SAME method the import handler calls
 * (Compatibility\Predis::restoreKeys) with the SAME argument the fixed handler
 * now computes ($ttl * 1000), then compares the resulting TTL against what the
 * old argument produced. No file upload, no CSRF, no guessing.
 *
 *   php/php.exe scripts/check-redis-restore-ttl.php
 */

declare(strict_types=1);

$root = dirname(__DIR__);
require_once 'phar://'.$root.'/webapp/predis.phar/vendor/autoload.php';

$autoload = static function (string $class): void {
    $prefix = 'RobiNN\\Pca\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $file = dirname(__DIR__).'/webapp/src/'.str_replace('\\', '/', $relative).'.php';

    if (is_file($file)) {
        require_once $file;
    }
};

spl_autoload_register($autoload);

$host = getenv('PCA_TEST_REDIS_HOST') ?: '127.0.0.1';
$port = (int) (getenv('PCA_TEST_REDIS_PORT') ?: 6379);
$password = getenv('PCA_TEST_REDIS_PASSWORD') ?: '';

// The Redis panel talks to the client through this compatibility wrapper.
$redis = new RobiNN\Pca\Dashboards\Redis\Compatibility\Predis([
    'scheme' => 'tcp',
    'host'   => $host,
    'port'   => $port,
    'database' => 9,
] + ($password !== '' ? ['password' => $password] : []));

echo "connected to {$host}:{$port} db9\n";

const SOURCE_TTL = 2000;

$redis->del(['d2r:src', 'd2r:fixed', 'd2r:old']);
$redis->set('d2r:src', 'backup-payload');
$redis->expire('d2r:src', SOURCE_TTL);

$exportedTtl = (int) $redis->ttl('d2r:src');
printf("source key TTL (what export writes) : %ds\n", $exportedTtl);

$payload = (string) $redis->dump('d2r:src');
printf("serialized payload                  : %d bytes\n", strlen($payload));

// ---- fixed handler -------------------------------------------------------
// RedisTrait now computes: $milliseconds = $ttl > 0 ? $ttl * 1000 : 0;
$milliseconds = $exportedTtl > 0 ? $exportedTtl * 1000 : 0;
$fixedOk = $redis->restoreKeys('d2r:fixed', $milliseconds, $payload);
$fixedTtl = (int) $redis->ttl('d2r:fixed');

// ---- old handler --------------------------------------------------------
$oldOk = $redis->restoreKeys('d2r:old', $exportedTtl, $payload);
$oldTtl = (int) $redis->ttl('d2r:old');

printf("\nrestoreKeys(key, %-9d, payload) -> %s, TTL = %ds   <- FIXED\n",
    $milliseconds, $fixedOk ? 'true ' : 'false', $fixedTtl);
printf("restoreKeys(key, %-9d, payload) -> %s, TTL = %ds   <- OLD\n",
    $exportedTtl, $oldOk ? 'true ' : 'false', $oldTtl);

$ok = $fixedOk && $fixedTtl > $exportedTtl - 60 && $fixedTtl <= $exportedTtl
    && $oldTtl >= 0 && $oldTtl < 10;

echo "\n";
echo $ok
    ? "PASS: the fixed argument preserves the exported lifetime, and the old one\n"
      ."      reproduces the ~1000x shrink reported in D2.\n"
    : "FAIL/INCONCLUSIVE: see the numbers above.\n";

$redis->del(['d2r:src', 'd2r:fixed', 'd2r:old']);

exit($ok ? 0 : 1);
