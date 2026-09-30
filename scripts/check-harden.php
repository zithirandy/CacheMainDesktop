<?php
/**
 * PHP-level assertions for the harden pass (run with the bundled php.exe):
 *   php/php.exe scripts/check-harden.php
 *
 * Exit 0 = all green. Any failure prints FAIL and exits 1.
 */

declare(strict_types=1);

require __DIR__.'/../webapp/src/functions.php';
autoload(__DIR__.'/../webapp/');

use RobiNN\Pca\Format;

$failures = 0;

function check(string $name, bool $ok): void {
    global $failures;

    echo ($ok ? 'ok   ' : 'FAIL ').$name."\n";

    if (!$ok) {
        $failures++;
    }
}

// Data truthfulness: epoch 0 / negative timestamps must read as Never,
// not "57 years ago".
check('timeDiff(0) is Never', Format::timeDiff(0) === 'Never');
check('timeDiff(-5) is Never', Format::timeDiff(-5) === 'Never');
check('timeDiff(now) is recent', str_contains(Format::timeDiff(time()), 'second'));

// Number format: Chinese conventions - dot decimals, comma thousands.
check('number uses dot decimals', Format::number(64.0, 1) === '64.0');
check('number uses comma thousands', Format::number(7197) === '7,197');

exit($failures === 0 ? 0 : 1);
