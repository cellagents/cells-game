// Client userAgent string emitted on every protocol 1.0 subscribe.
// Format: `web/<package-version>`. Webpack inlines the version via
// a DefinePlugin fallback; if the define is not available at
// bundle time we fall back to a sentinel so the mandatory
// subscribe field is still present.

declare const __CELLS_VERSION__: string | undefined;

export const USER_AGENT: string = (() => {
    try {
        return typeof __CELLS_VERSION__ === 'string'
            ? `web/${__CELLS_VERSION__}`
            : 'web/unknown';
    } catch {
        return 'web/unknown';
    }
})();
