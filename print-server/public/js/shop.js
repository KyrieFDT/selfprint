let shopState = { token: '', currentTab: 'pending', refreshId: null };

async function initShop() {
  // Init PDF.js
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // Auto-login as owner
  try {
    const data = await api.login('owner');
    shopState.token = data.token;
    api.setToken(data.token);
    api.connectWS();
    api.onWs('queue_update', () => refreshCurrentTab());
  } catch (e) {
    console.error('Login failed:', e);
    document.getElementById('lanUrl').textContent = '登录失败，请刷新页面';
    return;
  }

  // Load network info
  try {
    const resp = await fetch('/api/network/info');
    const netData = await resp.json();
    if (netData.success && netData.data.lan_url) {
      document.getElementById('lanUrl').textContent = netData.data.lan_url;
      if (typeof QRCode !== 'undefined') {
        new QRCode(document.getElementById('qrCode'), {
          text: netData.data.lan_url,
          width: 180, height: 180,
          colorDark: '#1f2937', colorLight: '#ffffff',
        });
      }
    } else {
      document.getElementById('lanUrl').textContent = 'http://localhost:3000';
    }
  } catch (e) {
    document.getElementById('lanUrl').textContent = 'http://localhost:3000';
  }

  // Tab switching
  document.querySelectorAll('#orderTabs .tab-btn').forEach(b => {
    b.onclick = () => switchTab(b.dataset.tab);
  });

  // Start refresh
  await refreshAll();
  shopState.refreshId = setInterval(refreshAll, 5000);

  // Clock
  updateClock();
  setInterval(updateClock, 30000);
}

function updateClock() {
  document.getElementById('clock').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast toast-' + (type || 'success');
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2500);
}

function switchTab(tab) {
  shopState.currentTab = tab;
  document.querySelectorAll('#orderTabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('tab-pending').style.display = tab === 'pending' ? '' : 'none';
  document.getElementById('tab-queue').style.display = tab === 'queue' ? '' : 'none';
  document.getElementById('tab-completed').style.display = tab === 'completed' ? '' : 'none';
  refreshCurrentTab();
}

async function refreshAll() {
  try {
    const data = await api.getQueue();
    // 加载当前选中的打印机
    try {
      const active = await api.getActivePrinter();
      activePrinter = active.printer_name || '';
    } catch (e) {}
    renderPrinters(data.printers || []);

    // Fetch all paid/printing orders
    const queueData = data.queue || [];
    const printingData = data.printing || [];

    // Fetch pending_pay orders
    const pendingResp = await api.request('/queue/staff/pending-pay');
    const pendingOrders = pendingResp || [];

    renderPending(pendingOrders);
    renderQueue(queueData, printingData);

    // Stats
    try {
      const stats = await api.getDashboard();
      document.getElementById('statOrders').textContent = stats.today.total_orders || 0;
      document.getElementById('statRevenue').textContent = '¥' + parseFloat(stats.today.revenue || 0).toFixed(1);
    } catch (e) {}

  } catch (e) { console.error('Refresh failed:', e); }
}

async function refreshCurrentTab() {
  try {
    const data = await api.getQueue();
    if (shopState.currentTab === 'pending') {
      const pendingResp = await api.request('/queue/staff/pending-pay');
      renderPending(pendingResp || []);
    }
    if (shopState.currentTab === 'queue') renderQueue(data.queue || [], data.printing || []);
    if (shopState.currentTab === 'completed') loadCompleted();
    renderPrinters(data.printers || []);
  } catch (e) {}
}

let activePrinter = '';

function renderPrinters(printers) {
  const panel = document.getElementById('printerPanel');
  const select = document.getElementById('printerSelect');
  const hint = document.getElementById('activePrinterHint');

  if (!printers || printers.length === 0) {
    panel.innerHTML = '<div class="empty">暂无打印机</div>';
    select.innerHTML = '<option value="">-- 无可用打印机 --</option>';
    hint.textContent = '';
    return;
  }

  panel.innerHTML = printers.map(p => {
    const dot = (p.agent_status === 'online' || p.agent_status === 'idle') ? 'online'
      : (p.agent_status === 'printing' ? 'printing' : 'offline');
    const statusText = dot === 'online' ? '就绪' : (dot === 'printing' ? '工作中' : '离线');
    const isActive = p.name === activePrinter;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0">
      <div>
        <span class="status-dot ${dot}"></span>
        <span style="font-size:13px;font-weight:600">${p.name}</span>
        ${isActive ? '<span style="font-size:11px;color:var(--primary);margin-left:4px">◀ 当前</span>' : ''}
      </div>
      <span style="font-size:12px;color:var(--gray-500)">${p.printer_type === 'bw' ? '黑白' : '彩色'} · ${statusText}</span>
    </div>`;
  }).join('');

  // 填充下拉框
  const currentVal = select.value;
  select.innerHTML = '<option value="">-- 选择打印机 --</option>' +
    printers.map(p => `<option value="${p.name}">${p.name} (${p.printer_type === 'color' ? '彩色' : '黑白'})</option>`).join('');
  if (activePrinter) {
    select.value = activePrinter;
    hint.textContent = '当前打印: ' + activePrinter;
  } else if (currentVal) {
    select.value = currentVal;
  }
}

async function selectPrinter() {
  const select = document.getElementById('printerSelect');
  const name = select.value;
  if (!name) { showToast('请先选择一台打印机', 'error'); return; }
  try {
    await api.selectPrinter(name);
    activePrinter = name;
    document.getElementById('activePrinterHint').textContent = '当前打印: ' + name;
    showToast('已切换打印机: ' + name);
  } catch (err) {
    showToast('切换失败: ' + err.message, 'error');
  }
}

function renderPending(orders) {
  const badge = document.getElementById('badgePending');
  const container = document.getElementById('pendingList');
  if (!orders || orders.length === 0) {
    badge.style.display = 'none';
    container.innerHTML = '<div class="empty">暂无待确认订单 🎉</div>';
    return;
  }
  badge.style.display = 'inline';
  badge.textContent = orders.length;

  container.innerHTML = orders.map(o => `
    <div class="order-item">
      <div style="flex:1">
        <div style="font-weight:600;font-size:13px">#${o.id} ${o.customer_name || '顾客'}</div>
        <div style="font-size:12px;color:var(--gray-600)">${o.file_name} · ${o.file_pages}页</div>
        <div style="font-size:12px;color:var(--gray-500)">
          ${o.paper_size} ${o.color_mode === 'bw' ? '黑白' : '彩色'} ${o.duplex === 'double' ? '双面' : '单面'} ×${o.copies || 1}份
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:var(--primary)">¥${parseFloat(o.total_amount || 0).toFixed(2)}</div>
        <button class="btn btn-outline btn-xs" onclick="previewOrderById(${o.id})" style="margin-top:4px">预览</button>
        <button class="btn btn-success btn-xs" onclick="confirmPay(${o.id})" style="margin-top:4px">确认收款</button>
        <button class="btn btn-danger btn-xs" onclick="cancelOrder(${o.id})" style="margin-top:4px">取消</button>
      </div>
    </div>
  `).join('');
}

function renderQueue(queue, printing) {
  const container = document.getElementById('queueList');

  let html = '';

  // Printing
  if (printing && printing.length > 0) {
    html += '<div style="font-weight:600;font-size:13px;margin-bottom:6px;color:var(--primary)">🖨️ 打印中</div>';
    html += printing.map(o => `
      <div class="order-item" style="background:#eef2ff;padding:10px;border-radius:8px;margin-bottom:4px">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">#${o.id} ${o.file_name}</div>
          <div style="font-size:11px;color:var(--gray-500)">开始于 ${o.started_at ? new Date(o.started_at).toLocaleTimeString() : '--'}</div>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-xs" onclick="previewOrderById(${o.id})">预览</button>
          <button class="btn btn-success btn-xs" onclick="completeOrder(${o.id}, true)">完成</button>
        </div>
      </div>
    `).join('');
  }

  // Queue
  if (queue && queue.length > 0) {
    html += '<div style="font-weight:600;font-size:13px;margin:10px 0 6px;color:var(--gray-700)">⏳ 排队中</div>';
    html += queue.map((item, i) => {
      const o = item.order_info || {};
      return `<div class="order-item">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">#${o.id || item.order_id} ${o.customer_name || ''}</div>
          <div style="font-size:12px;color:var(--gray-600)">${o.file_name || ''} · ${o.total_sides || 0}面</div>
          <div style="font-size:11px;color:var(--gray-500)">预计 ${Math.ceil((item.wait_seconds || 0) / 60)} 分钟</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-outline btn-xs" onclick="previewOrderById(${o.id || item.order_id})">预览</button>
          <button class="btn btn-primary btn-xs" onclick="startPrint(${o.id || item.order_id})">开始打印</button>
          <button class="btn btn-danger btn-xs" onclick="cancelQueueOrder(${o.id || item.order_id})">取消</button>
        </div>
      </div>`;
    }).join('');
  }

  if (!html) html = '<div class="empty">暂无排队订单</div>';
  container.innerHTML = html;
}

// ==================== Preview Modal ====================

let modalState = { urls: [], idx: 0, totalPages: 0, pdfDoc: null };

async function previewOrderById(orderId) {
  if (!orderId) { showToast('订单ID不存在', 'error'); return; }

  document.getElementById('previewModal').style.display = 'flex';
  document.getElementById('modalContent').innerHTML =
    '<div style="text-align:center;padding:40px"><div style="font-size:36px;margin-bottom:8px">⏳</div><div>正在加载预览...</div></div>';
  document.getElementById('modalTitle').textContent = '📋 订单 #' + orderId + ' 预览';
  document.getElementById('modalNav').style.display = 'none';
  modalState = { urls: [], idx: 0, totalPages: 0, pdfDoc: null };

  try {
    const order = await api.getOrder(orderId);
    const fileUrl = order.file_url;
    if (!fileUrl) { showModalError('该订单无文件可预览'); return; }

    const previewUrl = '/api/files/preview/' + fileUrl;

    if (typeof pdfjsLib !== 'undefined') {
      // Use PDF.js to render pages
      const pdf = await pdfjsLib.getDocument(previewUrl).promise;
      modalState.pdfDoc = pdf;
      modalState.totalPages = pdf.numPages;
      modalState.idx = 0;

      document.getElementById('modalNav').style.display = pdf.numPages > 1 ? 'flex' : 'none';
      await renderModalPage(0);
    } else {
      // Fallback to iframe
      modalState.urls = [previewUrl];
      modalState.idx = 0;
      showModalIframe();
    }
  } catch (e) {
    showModalError('加载失败: ' + e.message);
  }
}

async function renderModalPage(pageIdx) {
  const pdf = modalState.pdfDoc;
  if (!pdf) return;

  document.getElementById('modalContent').innerHTML =
    '<div style="text-align:center;padding:40px"><span style="color:var(--gray-500)">渲染中...</span></div>';

  try {
    const page = await pdf.getPage(pageIdx + 1);
    const scale = 1.5;
    const vp = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.maxWidth = '100%';
    canvas.style.height = 'auto';
    canvas.style.borderRadius = '4px';
    canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,.1)';

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    document.getElementById('modalContent').innerHTML = '';
    document.getElementById('modalContent').appendChild(canvas);
    document.getElementById('modalIndicator').textContent =
      `${pageIdx + 1} / ${modalState.totalPages}`;
  } catch (e) {
    showModalError('渲染失败: ' + e.message);
  }
}

function showModalIframe() {
  const url = modalState.urls[modalState.idx];
  document.getElementById('modalContent').innerHTML =
    `<iframe src="${url}" style="width:100%;height:60vh;border:none;border-radius:8px"></iframe>`;
  document.getElementById('modalIndicator').textContent =
    `${modalState.idx + 1}/${modalState.urls.length}`;
}

function showModalError(msg) {
  document.getElementById('modalContent').innerHTML =
    `<div style="text-align:center;padding:40px;color:var(--danger)">⚠ ${msg}</div>`;
}

function modalPrev() {
  if (modalState.pdfDoc && modalState.idx > 0) {
    modalState.idx--;
    renderModalPage(modalState.idx);
  } else if (modalState.idx > 0) {
    modalState.idx--;
    showModalIframe();
  }
}

function modalNext() {
  if (modalState.pdfDoc && modalState.idx < modalState.totalPages - 1) {
    modalState.idx++;
    renderModalPage(modalState.idx);
  } else if (modalState.idx < modalState.urls.length - 1) {
    modalState.idx++;
    showModalIframe();
  }
}

function closePreview() {
  document.getElementById('previewModal').style.display = 'none';
  modalState.pdfDoc = null;
  modalState.urls.forEach(u => { if (u.startsWith('blob:')) URL.revokeObjectURL(u); });
  modalState.urls = [];
}

// ==================== Cancel Queue ====================

async function cancelQueueOrder(orderId) {
  if (!confirm('确定将此订单从打印队列中移除？')) return;
  try {
    await api.cancelOrder(orderId);
    showToast('订单已从队列移除');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function loadCompleted() {
  try {
    const data = await api.request('/queue/staff/recent-completed');
    const container = document.getElementById('completedList');
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty">暂无已完成订单</div>';
      return;
    }
    container.innerHTML = data.map(o => `
      <div class="order-item">
        <div style="flex:1">
          <div style="font-weight:600;font-size:13px">#${o.id} ${o.file_name}</div>
          <div style="font-size:12px;color:var(--gray-500)">${o.customer_name || ''} · ¥${parseFloat(o.total_amount || 0).toFixed(2)}</div>
          <div style="font-size:11px;color:var(--gray-400)">${o.completed_at ? new Date(o.completed_at).toLocaleTimeString() : ''}</div>
        </div>
        <span class="badge badge-completed">已完成</span>
      </div>
    `).join('');
  } catch (e) {}
}

// ==================== Actions ====================

async function confirmPay(orderId) {
  try {
    await api.request(`/queue/${orderId}/confirm-pay`, { method: 'PUT' });
    showToast('已确认收款，订单进入打印队列');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function cancelOrder(orderId) {
  if (!confirm('确认取消此订单？')) return;
  try {
    await api.request(`/orders/${orderId}/cancel`, { method: 'PUT' });
    showToast('订单已取消');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function startPrint(orderId) {
  try {
    await api.startOrder(orderId, 1);
    showToast('开始打印');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function completeOrder(orderId) {
  try {
    await api.completeOrder(orderId, true);
    showToast('打印完成');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

initShop();
