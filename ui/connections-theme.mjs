/**
 * Theme bootstrap for the connections window (external so the page CSP can
 * keep script-src at 'self'). Reads ?theme= from the shell at load time and,
 * in system mode, follows OS color-scheme changes live.
 */

const theme = new URLSearchParams(location.search).get('theme');

const apply = mode => {
    const dark = mode === 'dark'
        || (mode !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);

    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
};

apply(theme ?? 'system');

if (!theme || theme === 'system') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply('system'));
}
