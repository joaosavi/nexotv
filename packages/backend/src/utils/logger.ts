import env from '../config/env';

export function makeLogger(component?: string) {
    const enabled = !!env.DEBUG;
    const prefix = component ? ` [${component}]` : '';
    const ts = () => new Date().toISOString();
    return {
        debug: (...a: any[]) => { if (enabled) console.log(`${ts()} [DEBUG]${prefix}`, ...a); },
        info:  (...a: any[]) => console.log(`${ts()} [INFO]${prefix}`, ...a),
        warn:  (...a: any[]) => console.warn(`${ts()} [WARN]${prefix}`, ...a),
        error: (...a: any[]) => console.error(`${ts()} [ERROR]${prefix}`, ...a),
    };
}
