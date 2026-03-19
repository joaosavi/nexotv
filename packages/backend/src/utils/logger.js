const env = require('../config/env');

function makeLogger() {
    const enabled = !!env.DEBUG;
    return {
        debug: (...a) => { if (enabled) console.log('[DEBUG]', ...a); },
        info: (...a) => console.log('[INFO]', ...a),
        warn: (...a) => console.warn('[WARN]', ...a),
        error: (...a) => console.error('[ERROR]', ...a)
    };
}

module.exports = { makeLogger };
