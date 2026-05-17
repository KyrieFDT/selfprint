const API_BASE = '/api';
const WS_BASE = location.protocol === 'https:' ? `wss://${location.host}/ws` : `ws://${location.host}/ws`;

const api = {
  token: null,
  customer: null,
  role: 'customer',
  ws: null,

  setToken(t) { this.token = t; localStorage.setItem('token', t); },
  getToken() { return this.token || localStorage.getItem('token'); },

  async request(path, options = {}) {
    const headers = { ...options.headers };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const resp = await fetch(API_BASE + path, { ...options, headers });
    const data = await resp.json();
    if (!data.success) throw new Error(data.message || '请求失败');
    return data.data;
  },

  async login(nickname) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: { code: 'dev', nickname: nickname || '用户' + Math.random().toString(36).slice(2, 6) },
    });
    this.setToken(data.token);
    this.customer = data.customer;
    this.role = data.isOwner ? 'owner' : (data.isStaff ? 'staff' : 'customer');
    return data;
  },

  connectWS() {
    if (this.ws) return;
    const wsUrl = WS_BASE + '?token=' + this.getToken();
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => console.log('[WS] 已连接');
    this.ws.onclose = () => { console.log('[WS] 断开'); this.ws = null; };
    this.ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('ws:' + data.type, { detail: data }));
        window.dispatchEvent(new CustomEvent('ws:*', { detail: data }));
      } catch (err) {}
    };
  },

  onWs(type, cb) {
    window.addEventListener('ws:' + type, (e) => cb(e.detail));
  },

  uploadFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    return this.request('/files/upload', { method: 'POST', body: fd });
  },

  calcPrice(params) {
    return this.request('/orders/calc-price', { method: 'POST', body: params });
  },

  createOrder(params) {
    return this.request('/orders/create', { method: 'POST', body: params });
  },

  getOrder(id) {
    return this.request(`/orders/${id}`);
  },

  getMyOrders(page = 1) {
    return this.request(`/orders/my?page=${page}&limit=20`);
  },

  formatOrder(id) {
    return this.request(`/orders/${id}/format`, { method: 'POST' });
  },

  cancelOrder(id) {
    return this.request(`/orders/${id}/cancel`, { method: 'PUT' });
  },

  simulatePay(orderId, method = 'wechat') {
    return this.request('/pay/simulate-pay', { method: 'POST', body: { order_id: orderId, payment_method: method } });
  },

  getQueue() {
    return this.request('/queue/staff');
  },

  getWaitingTime(orderId) {
    return this.request(`/queue/${orderId}/waiting`);
  },

  startOrder(orderId, printerId) {
    return this.request(`/queue/${orderId}/start`, { method: 'PUT', body: { printer_id: printerId } });
  },

  completeOrder(orderId, isNormal = true) {
    return this.request(`/queue/${orderId}/complete`, { method: 'PUT', body: { is_normal: isNormal } });
  },

  pickOrder(orderId) {
    return this.request(`/queue/${orderId}/pick`, { method: 'PUT' });
  },

  expediteOrder(orderId) {
    return this.request(`/queue/${orderId}/expedite`, { method: 'PUT' });
  },

  staffCreateOrder(params) {
    return this.request('/queue/create-by-staff', { method: 'POST', body: params });
  },

  getCustomerConfig() {
    return this.request('/config/customer');
  },

  getPrices() {
    return this.request('/config/prices');
  },

  updatePrices(prices) {
    return this.request('/config/prices', { method: 'PUT', body: { prices } });
  },

  getPrinters() {
    return this.request('/config/printers');
  },

  updatePrinters(printers) {
    return this.request('/config/printers', { method: 'PUT', body: { printers } });
  },

  selectPrinter(printerName) {
    return this.request('/config/printers/select', { method: 'PUT', body: { printer_name: printerName } });
  },

  getActivePrinter() {
    return this.request('/config/printers/active');
  },

  getOptions() {
    return this.request('/config/options');
  },

  updateOptions(options) {
    return this.request('/config/options', { method: 'PUT', body: { options } });
  },

  getDefaults() {
    return this.request('/config/defaults');
  },

  updateDefaults(defaults) {
    return this.request('/config/defaults', { method: 'PUT', body: { defaults } });
  },

  getShopConfig() {
    return this.request('/config/shop');
  },

  updateShopConfig(data) {
    return this.request('/config/shop', { method: 'PUT', body: data });
  },

  getDashboard() {
    return this.request('/stats/dashboard');
  },

  getDailyStats(date) {
    return this.request(`/stats/daily?date=${date || ''}`);
  },
};
