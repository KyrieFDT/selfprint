const jwt = require('jsonwebtoken');
const config = require('../config');

function auth({ required = true, roles = [] } = {}) {
  return async (ctx, next) => {
    const token = ctx.headers.authorization?.replace('Bearer ', '')
      || ctx.query.token;

    if (!token) {
      if (!required) return next();
      ctx.status = 401;
      ctx.body = { success: false, message: '请先登录' };
      return;
    }

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      ctx.state.customerId = decoded.customerId;
      ctx.state.shopId = decoded.shopId || 1;
      ctx.state.role = decoded.role || 'customer';
      ctx.state.staffId = decoded.staffId || null;

      if (roles.length && !roles.includes(ctx.state.role)) {
        ctx.status = 403;
        ctx.body = { success: false, message: '权限不足' };
        return;
      }

      return next();
    } catch (err) {
      ctx.status = 401;
      ctx.body = { success: false, message: '登录已过期，请重新登录' };
    }
  };
}

module.exports = auth;
