const env = require('../config/env');

function isPrivateIp(ip) {
    if (env.ALLOW_LOCAL_URLS) return false;

    return (
        ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1' ||
        /^10\./.test(ip) ||
        /^192\.168\./.test(ip) ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip) ||
        /^169\.254\./.test(ip)
    );
}

module.exports = { isPrivateIp };
