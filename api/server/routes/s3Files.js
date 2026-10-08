const cookie = require('cookie');
const { authenticateRequest, createS3ProxyHandler, isEnabled } = require('@librechat/api');
const { findSession } = require('~/models');

const cookieAuth = {
  parseCookies: cookie.parse,
  isOpenIdReuseEnabled: () => isEnabled(process.env.OPENID_REUSE_TOKENS),
  findSession,
};

module.exports = createS3ProxyHandler({
  authenticate: (req) => authenticateRequest(req, cookieAuth),
});
