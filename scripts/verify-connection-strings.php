<?php
/**
 * Verify that the connection strings handed to the user actually work with the
 * clients this project uses: Predis (which the Redis dashboard uses, since the
 * bundled PHP has no phpredis extension) and the protocol for Memcached.
 *
 *   php/php.exe scripts/verify-connection-strings.php
 */

declare(strict_types=1);

$root = dirname(__DIR__);
$results = [];

// --- Redis via Predis, using the exact URI form we advertise ----------------
require_once 'phar://'.$root.'/webapp/predis.phar/vendor/autoload.php';

$redisUris = [
    'redis://127.0.0.1:6379',
    'redis://127.0.0.1:6379/0',
];

foreach ($redisUris as $uri) {
    try {
        $client = new Predis\Client($uri);
        $pong = $client->ping();
        $size = $client->dbsize();
        $keys = $client->keys('*');
        sort($keys);
        $results[] = sprintf(
            'OK    redis  %-28s ping=%-4s dbsize=%d keys=%s',
            $uri,
            is_object($pong) ? 'PONG' : var_export($pong, true),
            $size,
            implode(',', array_slice($keys, 0, 4)).(count($keys) > 4 ? ',...' : '')
        );
    } catch (Throwable $e) {
        $results[] = sprintf('FAIL  redis  %-28s %s', $uri, $e->getMessage());
    }
}

// --- Memcached, using the same text protocol the bundled client speaks -------
$mcTargets = [
    '127.0.0.1:11211',
];

foreach ($mcTargets as $target) {
    [$host, $port] = explode(':', $target);

    $sock = @stream_socket_client("tcp://$host:$port", $errno, $errstr, 3);

    if ($sock === false) {
        $results[] = sprintf('FAIL  memcached %-25s %s (%d)', $target, $errstr, $errno);
        continue;
    }

    stream_set_timeout($sock, 3);

    // version + a real get, so we prove reads work and not just the handshake.
    fwrite($sock, "version\r\n");
    $version = trim((string) fgets($sock));

    fwrite($sock, "get greeting\r\n");
    $body = '';
    while (($line = fgets($sock)) !== false) {
        $body .= $line;
        if (trim($line) === 'END') {
            break;
        }
    }

    fclose($sock);

    $found = str_contains($body, 'VALUE greeting');

    $results[] = sprintf(
        'OK    memcached %-25s %s  get greeting=%s',
        $target,
        $version,
        $found ? 'hit' : 'miss'
    );
}

echo implode("\n", $results), "\n";

$failed = count(array_filter($results, static fn (string $r): bool => str_starts_with($r, 'FAIL')));
echo $failed === 0 ? "ALL CONNECTION STRINGS VERIFIED\n" : "$failed FAILED\n";

exit($failed === 0 ? 0 : 1);
