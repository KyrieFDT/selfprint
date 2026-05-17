const http = require('http');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://localhost:3000';
let token = '';

function request(method, url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + url);
    const options = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      headers: { ...headers },
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve({ status: res.statusCode, data });
        } catch (e) {
          resolve({ status: res.statusCode, data: Buffer.concat(chunks).toString() });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function auth() {
  return { Authorization: `Bearer ${token}` };
}

async function run() {
  console.log('========================================');
  console.log('  自助打印系统 - 端到端测试');
  console.log('========================================\n');

  // 1. Login
  console.log('1. 登录...');
  const loginResp = await request('POST', '/api/auth/login', { code: 'dev', nickname: '测试用户' });
  token = loginResp.data.data.token;
  console.log(`   ✓ 登录成功, customerId=${loginResp.data.data.customer.id}`);
  console.log(`   Token: ${token.slice(0, 30)}...\n`);

  // 2. Get config
  console.log('2. 获取顾客端配置...');
  const configResp = await request('GET', '/api/config/customer', null, auth());
  console.log(`   ✓ 定价项: ${Object.keys(configResp.data.data.prices).length}个`);
  console.log(`   A4黑白单面: ¥${configResp.data.data.prices.a4_bw_single}\n`);

  // 3. Create a real PDF and upload
  console.log('3. 生成测试PDF并上传...');
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([595, 842]);
  const pdfBytes = await pdfDoc.save();
  const pdfPath = path.join(os.tmpdir(), 'e2e-test.pdf');
  fs.writeFileSync(pdfPath, pdfBytes);

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));

  const uploadResult = await new Promise((resolve, reject) => {
    const headers = { ...form.getHeaders(), ...auth() };
    const u = new URL(BASE + '/api/files/upload');
    const req = http.request({
      method: 'POST', hostname: u.hostname, port: u.port,
      path: u.pathname, headers,
    }, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
    });
    req.on('error', reject);
    form.pipe(req);
  });

  if (!uploadResult.success) {
    console.log(`   ✗ 上传失败: ${uploadResult.message}`);
    process.exit(1);
  }
  const fileId = uploadResult.data.file_id;
  const filePages = uploadResult.data.file_pages;
  console.log(`   ✓ 上传成功: ${uploadResult.data.file_name}`);
  console.log(`   fileId: ${fileId}, pages: ${filePages}\n`);

  // 4. Calc price
  console.log('4. 计算价格...');
  const priceResp = await request('POST', '/api/orders/calc-price', {
    file_pages: filePages, color_mode: 'bw', duplex: 'single',
    paper_size: 'A4', copies: 2, layout: '1in1', binding: 'none',
  }, auth());
  console.log(`   ✓ 预估: ${priceResp.data.data.total_sides}面 ¥${priceResp.data.data.total_amount}\n`);

  // 5. Create order
  console.log('5. 创建订单...');
  const orderResp = await request('POST', '/api/orders/create', {
    file_id: fileId, file_name: 'e2e-test.pdf', file_pages: filePages,
    color_mode: 'bw', duplex: 'single', paper_size: 'A4', copies: 2,
    layout: '1in1', binding: 'none',
    total_amount: priceResp.data.data.total_amount,
  }, auth());
  const orderId = orderResp.data.data.order_id;
  console.log(`   ✓ 订单创建: #${orderId} ${orderResp.data.data.order_no}\n`);

  // 6. Pay
  console.log('6. 模拟支付...');
  const payResp = await request('POST', '/api/pay/simulate-pay', {
    order_id: orderId,
  }, auth());
  console.log(`   ✓ ${payResp.data.message}\n`);

  // 7. Check queue
  console.log('7. 查询排队状态...');
  const queueResp = await request('GET', `/api/queue/${orderId}/waiting`, null, auth());
  console.log(`   位置: ${queueResp.data.data.position}/${queueResp.data.data.total}`);
  console.log(`   等待: ${queueResp.data.data.wait_display}\n`);

  // 8. Get order detail
  console.log('8. 获取订单详情...');
  const detailResp = await request('GET', `/api/orders/${orderId}`, null, auth());
  console.log(`   状态: ${detailResp.data.data.status}`);
  console.log(`   金额: ¥${detailResp.data.data.total_amount}`);
  console.log(`   文件: ${detailResp.data.data.file_name}\n`);

  // 9. Check order history
  console.log('9. 查看历史订单...');
  const historyResp = await request('GET', '/api/orders/my?page=1&limit=10', null, auth());
  console.log(`   共 ${historyResp.data.data.total} 个订单\n`);

  // 10. Create second order and verify queue position changes
  console.log('10. 创建第二笔订单，验证排队...');
  const order2Resp = await request('POST', '/api/orders/create', {
    file_id: fileId, file_name: 'e2e-test-2.pdf', file_pages: filePages,
    color_mode: 'color', duplex: 'double', paper_size: 'A4', copies: 1,
    layout: '1in1', binding: 'staple',
    total_amount: 7,
  }, auth());
  const order2Id = order2Resp.data.data.order_id;
  await request('POST', '/api/pay/simulate-pay', { order_id: order2Id }, auth());

  const q1 = await request('GET', `/api/queue/${orderId}/waiting`, null, auth());
  const q2 = await request('GET', `/api/queue/${order2Id}/waiting`, null, auth());
  console.log(`   订单#${orderId}: 位置 ${q1.data.data.position}/${q1.data.data.total} - ${q1.data.data.wait_display}`);
  console.log(`   订单#${order2Id}: 位置 ${q2.data.data.position}/${q2.data.data.total} - ${q2.data.data.wait_display}`);

  // Cleanup
  fs.unlinkSync(pdfPath);
  console.log('\n========================================');
  console.log('  全部测试通过! ✓');
  console.log('========================================');
}

run().catch((err) => {
  console.error('测试失败:', err.message);
  process.exit(1);
});
