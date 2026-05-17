const Router = require('koa-router');
const os = require('os');

const router = new Router({ prefix: '/api/network' });

// 手机扫码后可先访问此地址验证连通性
router.get('/ping', async (ctx) => {
  ctx.body = { success: true, data: { status: 'ok', server_time: new Date().toISOString() } };
});

router.get('/info', async (ctx) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const [name, nets] of Object.entries(interfaces)) {
    for (const net of nets) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push({
          name: name,
          address: net.address,
        });
      }
    }
  }

  const lanIP = addresses.find(a =>
    a.address.startsWith('192.168.') ||
    a.address.startsWith('10.') ||
    a.address.startsWith('172.')
  ) || addresses[0];

  ctx.body = {
    success: true,
    data: {
      local_url: `http://localhost:3000`,
      lan_url: lanIP ? `http://${lanIP.address}:3000` : null,
      lan_ip: lanIP?.address || null,
      all_addresses: addresses,
      hostname: os.hostname(),
    },
  };
});

module.exports = router;
