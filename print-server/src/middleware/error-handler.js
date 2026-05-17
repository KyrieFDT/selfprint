const config = require('../config');

module.exports = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error('[Error]', err.stack || err.message);
    ctx.status = err.status || 500;
    const body = {
      success: false,
      message: err.expose ? err.message : '服务器内部错误',
    };
    if (config.env === 'development' && process.env.DEBUG_STACK === '1') {
      body.stack = err.stack;
    }
    ctx.body = body;
    ctx.app.emit('error', err, ctx);
  }
};
