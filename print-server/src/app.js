const Koa = require('koa');
const cors = require('koa-cors');
const { koaBody } = require('koa-body');
const serve = require('koa-static');
const path = require('path');
const fs = require('fs');
const errorHandler = require('./middleware/error-handler');
const config = require('./config');
const { ensureUploadDir } = require('./utils/storage');

const app = new Koa();

ensureUploadDir();

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : (config.env === 'production' ? false : '*');
app.use(cors({ origin: corsOrigin || '*' }));
app.use(errorHandler);
app.use(koaBody({
  multipart: true,
  formidable: {
    uploadDir: config.upload.dir,
    maxFileSize: config.upload.maxFileSizeMB * 1024 * 1024,
    keepExtensions: true,
  },
}));

const authRoutes = require('./modules/auth/auth.routes');
const fileRoutes = require('./modules/file/file.routes');
const orderRoutes = require('./modules/order/order.routes');
const queueRoutes = require('./modules/queue/queue.routes');
const configRoutes = require('./modules/config-mgr/config.routes');
const statsRoutes = require('./modules/stats/stats.routes');
const paymentRoutes = require('./modules/payment/payment.routes');
const agentRoutes = require('./modules/queue/agent.routes');
const networkRoutes = require('./modules/network/network.routes');

app.use(authRoutes.routes());
app.use(fileRoutes.routes());
app.use(orderRoutes.routes());
app.use(queueRoutes.routes());
app.use(configRoutes.routes());
app.use(statsRoutes.routes());
app.use(paymentRoutes.routes());
app.use(agentRoutes.routes());
app.use(networkRoutes.routes());

app.use(serve(path.join(__dirname, '..', 'public')));

app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && !ctx.path.startsWith('/api') && !ctx.path.startsWith('/ws') && !ctx.path.startsWith('/uploads')) {
    const filePath = path.join(__dirname, '..', 'public', ctx.path === '/' ? 'index.html' : ctx.path);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      ctx.type = 'html';
      ctx.body = fs.createReadStream(path.join(__dirname, '..', 'public', 'index.html'));
      return;
    }
  }
  return next();
});

app.on('error', (err) => {
  console.error('[App Error]', err);
});

module.exports = app;
