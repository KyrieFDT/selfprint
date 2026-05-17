const dayjs = require('dayjs');

function generateOrderNo(shopId) {
  const dateStr = dayjs().format('YYYYMMDDHHmmss');
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `P${dateStr}${rand}`;
}

module.exports = { generateOrderNo };
