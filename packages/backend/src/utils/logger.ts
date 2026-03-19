import env from '../config/env';

export function makeLogger() {
    const enabled = !!env.DEBUG;
    return {
        debug: (...a: any[]) => { if (enabled) console.log('[DEBUG]', ...a); },
        info: (...a: any[]) => console.log('[INFO]', ...a),
        warn: (...a: any[]) => console.warn('[WARN]', ...a),
        error: (...a: any[]) => console.error('[ERROR]', ...a)
    };
}
