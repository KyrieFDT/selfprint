const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { sub } = require('../config/redis');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    path: '/ws',
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.query.token;
    if (!token) return next(new Error('Authentication required'));

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      socket.customerId = decoded.customerId;
      socket.shopId = decoded.shopId || 1;
      socket.role = decoded.role || 'customer';
      socket.staffId = decoded.staffId || null;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { shopId, role, customerId } = socket;

    console.log(`[WS] 连接: customer=${customerId} role=${role} shop=${shopId}`);

    socket.join(`shop:${shopId}`);

    if (role === 'staff' || role === 'owner') {
      socket.join(`staff:${shopId}`);
    }

    socket.on('subscribe_order', (orderId) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[WS] 断开: customer=${customerId}`);
    });
  });

  sub.psubscribe('queue:*');

  sub.on('pmessage', (pattern, channel, message) => {
    try {
      const shopId = channel.split(':')[1];
      const data = JSON.parse(message);

      io.to(`shop:${shopId}`).emit('queue_update', data);

      if (data.order_id) {
        io.to(`order:${data.order_id}`).emit('order_update', data);
      }
    } catch (err) {
      console.error('[WS] 消息处理失败:', err.message);
    }
  });

  console.log('[Socket.IO] 已初始化');
  return io;
}

module.exports = { initSocket };
