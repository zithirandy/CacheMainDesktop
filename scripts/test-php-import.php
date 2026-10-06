<?php
/**
 * Unit test for Helpers::import() - the fix for defect D3.
 *
 * Before: a malformed upload was swallowed by an empty `catch (JsonException) {}`
 * and the page just reloaded, so the user saw nothing at all.
 * After: the outcome is returned (imported / skipped / failed / error) and
 * rendered as an alert by whoever called it.
 *
 * The upload itself is faked by writing $_FILES and running with $tests = true,
 * which skips the is_uploaded_file() check and the redirect.
 *
 *   php/php.exe scripts/test-php-import.php
 */

declare(strict_types=1);

$root = dirname(__DIR__);

require_once $root.'/webapp/src/functions.php';
autoload($root.'/webapp/');

use RobiNN\Pca\Helpers;

$tmp = sys_get_temp_dir();

$failures = 0;

/**
 * Run Helpers::import() against a given file body.
 *
 * @param callable(string): bool             $exists
 * @param callable(string, string, int): bool $store
 *
 * @return array{imported: int, skipped: int, failed: int, error: ?string}
 */
function runImport(string $body, callable $exists, callable $store, string $tmp): array {
    $file = tempnam($tmp, 'imp');
    file_put_contents($file, $body);

    $_FILES['import'] = ['error' => UPLOAD_ERR_OK, 'tmp_name' => $file, 'name' => 'import.json'];

    try {
        return Helpers::import($exists, $store, true);
    } finally {
        @unlink($file);
        unset($_FILES['import']);
    }
}

$neverExists = static fn (string $key): bool => false;
$alwaysExists = static fn (string $key): bool => true;
$storeOk = static fn (string $key, string $value, int $ttl): bool => true;
$storeFails = static fn (string $key, string $value, int $ttl): bool => false;

$cases = [
    [
        'malformed JSON is reported, not swallowed',
        'this is definitely not json {{{',
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['error'] !== null && str_contains((string) $r['error'], 'not valid JSON'),
    ],
    [
        'valid JSON that is not a list is reported',
        json_encode(['nope' => true]),
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['error'] !== null && str_contains((string) $r['error'], 'does not contain a list'),
    ],
    [
        'an empty list imports nothing but reports cleanly',
        '[]',
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['error'] === null && $r['imported'] === 0 && $r['failed'] === 0,
    ],
    [
        'valid entries are imported and counted',
        json_encode([
            ['key' => 'a', 'ttl' => 0, 'value' => '00'],
            ['key' => 'b', 'ttl' => 60, 'value' => '00'],
        ]),
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['imported'] === 2 && $r['error'] === null,
    ],
    [
        'existing keys are skipped and counted, not silently dropped',
        json_encode([['key' => 'a', 'ttl' => 0, 'value' => '00']]),
        $alwaysExists,
        $storeOk,
        static fn (array $r): bool => $r['skipped'] === 1 && $r['imported'] === 0,
    ],
    [
        'entries missing fields are counted as failed',
        json_encode([['key' => 'a'], ['ttl' => 1, 'value' => '00'], 'not-an-array']),
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['failed'] === 3,
    ],
    [
        'a store that rejects a value is counted as failed',
        json_encode([['key' => 'a', 'ttl' => 0, 'value' => 'zz']]),
        $neverExists,
        $storeFails,
        static fn (array $r): bool => $r['failed'] === 1 && $r['imported'] === 0,
    ],
    [
        'no uploaded file is reported',
        '',
        $neverExists,
        $storeOk,
        static fn (array $r): bool => $r['error'] !== null,
        true,   // simulate no $_FILES entry
    ],
];

foreach ($cases as $case) {
    [$label, $body, $exists, $store, $assert] = $case;
    $noFile = $case[5] ?? false;

    if ($noFile) {
        unset($_FILES['import']);
        $result = Helpers::import($exists, $store, true);
    } else {
        $result = runImport($body, $exists, $store, $tmp);
    }

    $ok = $assert($result);
    $failures += $ok ? 0 : 1;

    printf(
        "%s  %-52s %s\n",
        $ok ? 'ok  ' : 'FAIL',
        $label,
        json_encode($result, JSON_UNESCAPED_SLASHES)
    );
}

// The message helper must turn each outcome into something showable.
echo "\nmessages:\n";
foreach ([
    ['imported' => 3, 'skipped' => 0, 'failed' => 0, 'error' => null],
    ['imported' => 1, 'skipped' => 2, 'failed' => 0, 'error' => null],
    ['imported' => 0, 'skipped' => 0, 'failed' => 4, 'error' => null],
    ['imported' => 0, 'skipped' => 0, 'failed' => 0, 'error' => 'That file is not valid JSON: Syntax error'],
    ['imported' => 0, 'skipped' => 0, 'failed' => 0, 'error' => null],
] as $r) {
    printf("  %s\n", Helpers::importMessage($r));
}

echo $failures === 0
    ? "\nPASS: import outcomes are reported on every path\n"
    : "\n{$failures} FAILED\n";

exit($failures === 0 ? 0 : 1);
