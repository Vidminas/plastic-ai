const { createLoginUserLimiter, limiterCache } = require('@librechat/api');
const { logViolation } = require('~/cache');

module.exports = createLoginUserLimiter({ env: process.env, limiterCache, logViolation });
