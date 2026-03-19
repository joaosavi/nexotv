const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { makeLogger } = require('../utils/logger');

const log = makeLogger();

const globalIpLimiter = rateLimit({
    windowMs: env.IP_RATE_LIMIT_WINDOW_MS,
    max: env.IP_RATE_LIMIT_MAX,
    message: { error: 'Too many requests from this IP, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    handler: (req, res, next, options) => {
        log.warn(`[RateLimit] Global IP limit exceeded for IP: ${req.ip} (Max: ${options.max} requests per ${Math.round(options.windowMs / 1000)}s)`);
        res.status(options.statusCode).send(options.message);
    },
    skip: () => !env.IP_RATE_LIMIT_ENABLED
});

const tokenLimiter = rateLimit({
    windowMs: env.TOKEN_RATE_LIMIT_WINDOW_MS,
    max: env.TOKEN_RATE_LIMIT_MAX,
    keyGenerator: (req) => {
        return (req.ip || 'unknown') + ':' + (req.configToken || 'notoken');
    },
    message: { error: 'Too many addon requests with your token, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    handler: (req, res, next, options) => {
        const key = req.configToken ? 'Token(redacted)' : (req.ip || 'unknown');
        log.warn(`[RateLimit] Addon limit exceeded for ${key} (Max: ${options.max} requests per ${Math.round(options.windowMs / 1000)}s)`);
        res.status(options.statusCode).send(options.message);
    },
    skip: () => !env.TOKEN_RATE_LIMIT_ENABLED
});

module.exports = {
    globalIpLimiter,
    tokenLimiter
};
