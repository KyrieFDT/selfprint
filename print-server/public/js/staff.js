let staffState = { currentTab: 'queue', refreshTimer: null };

async function initStaff() {
  const token = api.getToken();
  if (!token) { window.location.href = '/'; return; }

  api.connectWS();
  api.onWs('queue_update', () => refreshCurrentTab());

  await refreshAll();
  staffState.refreshTimer = setInterval(refreshAll, 15000);
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast toast-' + (type || 'success');
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2500);
}

function switchTab(tab) {
  staffState.currentTab = tab;
  document.querySelectorAll('#staffTabs .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#staffTabs .tab-item').forEach(t => { if (t.textContent.includes({queue:'打印队列',printing:'打印中',completed:'已完成',offline:'代下单'}[tab])) t.classList.add('active'); });
  document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-' + tab).style.display = '';
  refreshCurrentTab();
}

async function refreshAll() {
  try {
    const data = await api.getQueue();
    renderPrinters(data.printers || []);
    renderQueue(data.queue || []);
  } catch (err) { console.error(err); }
}

async function refreshCurrentTab() {
  try {
    const data = await api.getQueue();
    if (staffState.currentTab === 'queue') renderQueue(data.queue || []);
    if (staffState.currentTab === 'printing') renderPrinting(data.printing || []);
    if (staffState.currentTab === 'completed') loadCompleted();
    renderPrinters(data.printers || []);
  } catch (err) {}
}

function renderPrinters(printers) {
  document.getElementById('printerStatusBar').innerHTML = printers.map(p => {
    const cls = p.agent_status === 'printing' ? 'printer-printing' : (p.agent_status === 'online' ? 'printer-online' : 'printer-offline');
    return `<span class="printer-status ${cls}">🖨️ ${p.name} (${p.printer_type === 'bw' ? '黑白' : '彩色'}) - ${p.agent_status === 'printing' ? '工作中' : (p.agent_status === 'online' ? '就绪' : '离线')}</span>`;
  }).join('');
}

function renderQueue(queue) {
  const container = document.getElementById('queueList');
  if (!queue || queue.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无待打印订单 🎉</div>';
    return;
  }
  container.innerHTML = queue.map((item, i) => {
    const o = item.order_info || {};
    const wmin = Math.ceil((item.wait_seconds || 0) / 60);
    return `<div class="queue-card ${o.is_expedited ? 'expedited' : ''}">
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-weight:700;font-size:14px">#${o.id || item.order_id}</span>
          <span style="color:var(--gray-500)">${o.customer_name || '--'}</span>
          ${o.is_expedited ? '<span class="badge badge-pending">加急</span>' : ''}
        </div>
        <div style="font-size:13px;color:var(--gray-600)">${o.file_name || ''} · ${o.file_pages || 0}页</div>
        <div style="font-size:12px;color:var(--gray-500)">
          ${o.paper_size || ''} ${o.color_mode === 'bw' ? '黑白' : '彩色'} ${o.duplex === 'double' ? '双面' : '单面'} ×${o.copies || 1}份
        </div>
        <div style="font-size:12px;color:var(--gray-500)">💰 ¥${parseFloat(o.total_amount || 0).toFixed(2)} | ⏱ 预计 ${wmin} 分钟</div>
      </div>
      <div style="display:flex;gap:6px;flex-direction:column">
        <button class="btn btn-primary btn-sm" onclick="startPrint(${o.id || item.order_id}, this)">开始打印</button>
        ${o.is_expedited ? '' : '<button class="btn btn-warning btn-sm" onclick="expedite(' + (o.id || item.order_id) + ')">加急</button>'}
      </div>
    </div>`;
  }).join('');
}

function renderPrinting(printing) {
  const container = document.getElementById('printingList');
  if (!printing || printing.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无打印中的订单</div>';
    return;
  }
  container.innerHTML = printing.map(o => `
    <div class="card">
      <div style="font-weight:700">#${o.id} ${o.order_no}</div>
      <div style="font-size:14px;color:var(--gray-600)">${o.file_name} · 打印机: ${o.printer_name || '--'}</div>
      <div style="font-size:12px;color:var(--gray-500)">开始于: ${o.started_at ? new Date(o.started_at).toLocaleTimeString() : '--'}</div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-success btn-sm" onclick="completePrint(${o.id}, true)">正常完成</button>
        <button class="btn btn-danger btn-sm" onclick="completePrint(${o.id}, false)">异常</button>
      </div>
    </div>
  `).join('');
}

async function loadCompleted() {
  try {
    const data = await api.request('/queue/staff/recent-completed');
    const container = document.getElementById('completedList');
    if (!data || data.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无已完成订单</div>';
      return;
    }
    container.innerHTML = data.map(o => `
      <div class="card" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:600;font-size:14px">#${o.id} ${o.file_name}</div>
          <div style="font-size:12px;color:var(--gray-500)">${o.customer_name || ''} · ¥${parseFloat(o.total_amount || 0).toFixed(2)}</div>
          <div style="font-size:12px;color:var(--gray-400)">${o.completed_at ? new Date(o.completed_at).toLocaleTimeString() : ''}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="pickOrder(${o.id})">取件</button>
      </div>
    `).join('');
  } catch (err) {}
}

async function startPrint(orderId, btn) {
  btn.disabled = true;
  try {
    await api.startOrder(orderId, 1);
    showToast('已开始打印');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
    btn.disabled = false;
  }
}

async function completePrint(orderId, isNormal) {
  try {
    await api.completeOrder(orderId, isNormal);
    showToast(isNormal ? '打印完成' : '已标记异常');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function expedite(orderId) {
  try {
    await api.expediteOrder(orderId);
    showToast('已加急');
    refreshAll();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function pickOrder(orderId) {
  try {
    await api.pickOrder(orderId);
    showToast('已取件');
    loadCompleted();
  } catch (err) {
    showToast('操作失败: ' + err.message, 'error');
  }
}

async function staffCreateOrder() {
  const fileInput = document.getElementById('offlineFileInput');
  const file = fileInput.files[0];
  if (!file) { showToast('请选择文件', 'error'); return; }

  try {
    const fileData = await api.uploadFile(file);
    await api.staffCreateOrder({
      customer_name: document.getElementById('offlineCustName').value || '到店顾客',
      file_id: fileData.file_id,
      file_name: fileData.file_name,
      file_pages: fileData.file_pages,
      paper_size: document.getElementById('offlinePaper').value,
      color_mode: document.getElementById('offlineColor').value,
      duplex: document.getElementById('offlineDuplex').value,
      copies: parseInt(document.getElementById('offlineCopies').value) || 1,
      layout: '1in1',
      binding: 'none',
      payment_method: document.getElementById('offlinePay').value,
    });
    showToast('订单已创建并入队');
    document.getElementById('offlineCustName').value = '';
    fileInput.value = '';
    switchTab('queue');
    refreshAll();
  } catch (err) {
    showToast('创建失败: ' + err.message, 'error');
  }
}

initStaff();
