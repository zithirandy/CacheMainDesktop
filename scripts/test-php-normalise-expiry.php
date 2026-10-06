<?php
/**
 * Unit test for PHPMem::normaliseExpiry() - the fix for defect D4.
 *
 * The two memcached sources report `exp` differently, verified against
 * memcached 1.6.45:
 *   - `me <key>` / metadump give a REMAINING ttl already (exp=600 for 10 min left)
 *   - the legacy `stats items` walk gives an ABSOLUTE epoch
 *
 * The UI needs remaining seconds either way. Only converting on one path made an
 * expiring key look permanent and prefilled 0 in the edit form, so saving a
 * value-only edit silently dropped the key's TTL.
 *
 *   php/php.exe scripts/test-php-normalise-expiry.php
 */

declare(strict_types=1);

require_once dirname(__DIR__).'/webapp/src/Dashboards/Memcached/PHPMem.php';

use RobiNN\Pca\Dashboards\Memcached\PHPMem;

$now = 1_700_000_000;

// [label, input, absoluteExp, expected exp]
$cases = [
    // "never expires" is the same from both sources.
    ['never expires (-1)',            ['exp' => -1],           false, -1],
    ['never expires (0)',             ['exp' => 0],            false, -1],
    ['no exp field at all',           ['key' => 'x'],          false, null],
    ['epoch: never expires (-1)',     ['exp' => -1],           true,  -1],
    ['epoch: never expires (0)',      ['exp' => 0],            true,  -1],

    // `me` already reports a duration: it must be passed through untouched.
    ['duration 600s (me path)',       ['exp' => 600],          false, 600],
    ['duration 1s (me path)',         ['exp' => 1],            false, 1],

    // Legacy walk reports an epoch: it must be converted.
    ['epoch 600s ahead',              ['exp' => $now + 600],   true,  600],
    ['epoch 1s ahead',                ['exp' => $now + 1],     true,  1],
    ['epoch already passed',          ['exp' => $now - 500],   true,  0],
    ['epoch exactly now',             ['exp' => $now],         true,  0],
];

$failures = 0;

foreach ($cases as [$label, $input, $absolute, $expected]) {
    $out = PHPMem::normaliseExpiry($input, $now, $absolute);
    $actual = array_key_exists('exp', $out) ? $out['exp'] : null;

    $ok = $actual === $expected;
    $failures += $ok ? 0 : 1;

    printf(
        "%s  %-24s exp=%-12s abs=%-5s -> %-12s (expected %s)\n",
        $ok ? 'ok  ' : 'FAIL',
        $label,
        var_export($input['exp'] ?? null, true),
        $absolute ? 'true' : 'false',
        var_export($actual, true),
        var_export($expected, true)
    );
}

// The reported symptom: editing a key with 600s left must prefill 600, not 0.
$meta = PHPMem::normaliseExpiry(['exp' => 600], $now);
$prefilled = ($meta['exp'] ?? -1) > 0 ? $meta['exp'] : 0;
$ok = $prefilled === 600;
$failures += $ok ? 0 : 1;
printf(
    "\n%s  edit form prefills expire=%d for a key with 600s left (was 0 before the fix)\n",
    $ok ? 'ok  ' : 'FAIL',
    $prefilled
);

echo $failures === 0
    ? "\nPASS: expiry normalisation matches what each source actually reports\n"
    : "\n{$failures} FAILED\n";

exit($failures === 0 ? 0 : 1);
