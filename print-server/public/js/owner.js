let ownerState = { currentTab: 'dashboard', printers: [], prices: [], options: {} };

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast toast-' + (type || 'success');
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2500);
}

async function initOwner() {
  const token = api.getToken();
  if (!token) { window.location.href = '/'; return; }

  document.querySelectorAll('#ownerTabs .tab-item').forEach(el => {
    el.onclick = () => switchTab(el.dataset.tab);
  });

  await switchTab('dashboard');
}

async function switchTab(tab) {
  ownerState.currentTab = tab;
  document.querySelectorAll('#ownerTabs .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelector(`#ownerTabs [data-tab="${tab}"]`).classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');

  if (tab === 'dashboard') await loadDashboard();
  if (tab === 'pricing') await loadPricing();
  if (tab === 'printers') await loadPrinters();
  if (tab === 'options') await loadOptions();
  if (tab === 'stats') await loadStats();
}

async function loadDashboard() {
  try {
    const data = await api.getDashboard();
    document.getElementById('statTodayRevenue').textContent = '¥' + parseFloat(data.today.revenue || 0).toFixed(2);
    document.getElementById('statTodayOrders').textContent = data.today.total_orders || 0;
    document.getElementById('statMonthRevenue').textContent = '¥' + parseFloat(data.month.revenue || 0).toFixed(2);
    document.getElementById('statMonthOrders').textContent = data.month.total_orders || 0;

    document.getElementById('dashPrinters').innerHTML = (data.printers || []).map(p => {
      const cls = p.agent_status === 'printing' ? 'printer-printing' : (p.agent_status === 'online' ? 'printer-online' : 'printer-offline');
      return `<span class="printer-status ${cls}" style="margin:4px">🖨️ ${p.name} - ${p.agent_status}</span>`;
    }).join('');
  } catch (err) { console.error(err); }
}

async function loadPricing() {
  try {
    const prices = await api.getPrices();
    ownerState.prices = prices;
    document.getElementById('priceList').innerHTML = prices.map(p => `
      <div class="price-row">
        <span style="font-size:14px">${p.display_name || p.item_key}</span>
        <div style="display:flex;align-items:center;gap:4px">
          <span>¥</span>
          <input type="number" step="0.01" min="0" value="${p.price}" data-key="${p.item_key}" class="price-input">
          <span style="font-size:12px;color:var(--gray-500)">/${p.unit || '面'}</span>
        </div>
      </div>
    `).join('');
  } catch (err) { showToast('加载定价失败', 'error'); }
}

async function savePrices() {
  const inputs = document.querySelectorAll('.price-input');
  const prices = [];
  inputs.forEach(inp => {
    const orig = ownerState.prices.find(p => p.item_key === inp.dataset.key);
    if (orig) {
      prices.push({ ...orig, price: parseFloat(inp.value) || 0 });
    }
  });
  try {
    await api.updatePrices(prices);
    showToast('定价已保存');
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

async function loadPrinters() {
  try {
    const printers = await api.getPrinters();
    ownerState.printers = printers;

    const hasAgentPrinter = printers.some(p => p.agent_id);
    document.getElementById('printerHint').style.display = hasAgentPrinter ? 'none' : 'block';

    if (printers.length === 0) {
      document.getElementById('printerList').innerHTML = '<div class="empty-state">暂无打印机，请添加或运行PC代理自动检测</div>';
      return;
    }

    document.getElementById('printerList').innerHTML = printers.map((p) => {
      let statusBadge = '';
      if (p.agent_id) {
        if (p.agent_status === 'online' || p.agent_status === 'idle') statusBadge = '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:10px;font-size:11px">● 在线</span>';
        else if (p.agent_status === 'printing') statusBadge = '<span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:10px;font-size:11px">● 打印中</span>';
        else statusBadge = '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px">● 离线</span>';
      } else {
        statusBadge = '<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:10px;font-size:11px">手动配置</span>';
      }

      return `<div class="price-row" style="flex-wrap:wrap;gap:6px">
        <input type="text" value="${p.name}" data-id="${p.id}" data-field="name" style="width:140px;font-size:13px">
        <select data-id="${p.id}" data-field="printer_type" style="font-size:13px">
          <option value="bw" ${p.printer_type === 'bw' ? 'selected' : ''}>黑白</option>
          <option value="color" ${p.printer_type === 'color' ? 'selected' : ''}>彩色</option>
          <option value="photo" ${p.printer_type === 'photo' ? 'selected' : ''}>照片</option>
        </select>
        <input type="number" step="0.1" value="${p.speed_base_sec}" data-id="${p.id}" data-field="speed_base_sec" style="width:65px;font-size:13px">
        <span style="font-size:11px;color:var(--gray-500)">秒/面</span>
        ${statusBadge}
        ${p.agent_id ? '<span style="font-size:10px;color:var(--gray-400)" title="由PC代理自动检测">🔗 代理</span>' : ''}
        <button class="btn btn-sm btn-outline" style="color:var(--danger);font-size:11px;margin-left:4px" onclick="deletePrinter(${p.id}, '${p.name}')">删除</button>
      </div>`;
    }).join('');
  } catch (err) { showToast('加载打印机失败', 'error'); }
}

async function savePrinters() {
  const printers = [];
  const rows = document.querySelectorAll('#printerList .price-row');
  rows.forEach(row => {
    const idInput = row.querySelector('[data-field="name"]');
    const id = idInput ? idInput.dataset.id : null;
    const name = row.querySelector('[data-field="name"]')?.value || '';
    const type = row.querySelector('[data-field="printer_type"]')?.value || 'bw';
    const speed = parseFloat(row.querySelector('[data-field="speed_base_sec"]')?.value) || 10;
    printers.push({ id: id ? parseInt(id) : undefined, name, printer_type: type, speed_base_sec: speed });
  });
  try {
    await api.updatePrinters(printers);
    showToast('打印机配置已保存');
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

function addPrinter() {
  ownerState.printers.push({ id: null, name: '新打印机', printer_type: 'bw', speed_base_sec: 10 });
  renderPrintersFromState();
}

function renderPrintersFromState() {
  document.getElementById('printerList').innerHTML = ownerState.printers.map((p, i) => `
    <div class="price-row">
      <input type="text" value="${p.name}" data-id="${p.id || ''}" data-field="name" style="width:150px">
      <select data-id="${p.id || ''}" data-field="printer_type">
        <option value="bw" ${p.printer_type === 'bw' ? 'selected' : ''}>黑白</option>
        <option value="color" ${p.printer_type === 'color' ? 'selected' : ''}>彩色</option>
        <option value="photo" ${p.printer_type === 'photo' ? 'selected' : ''}>照片</option>
      </select>
      <input type="number" step="0.1" value="${p.speed_base_sec}" data-id="${p.id || ''}" data-field="speed_base_sec" style="width:80px">
      <span style="font-size:11px;color:var(--gray-500)">秒/面</span>
      <button class="btn btn-sm btn-outline" style="color:var(--danger);font-size:11px" onclick="deletePrinter(${p.id}, '${p.name}')">删除</button>
    </div>
  `).join('');
}

async function deletePrinter(printerId, printerName) {
  if (!printerId) {
    ownerState.printers = ownerState.printers.filter(p => p.name !== printerName);
    renderPrintersFromState();
    showToast('已移除未保存的打印机');
    return;
  }
  if (!confirm(`确定要删除打印机 "${printerName}" 吗？`)) return;
  try {
    await api.deletePrinter(printerId);
    showToast('打印机已删除');
    await loadPrinters();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

async function loadOptions() {
  try {
    const [options, defaults, shop] = await Promise.all([
      api.getOptions(), api.getDefaults(), api.getShopConfig(),
    ]);
    ownerState.options = options;

    const optNames = [
      { key: 'duplex', label: '单双面选择' },
      { key: 'binding', label: '装订选项' },
      { key: 'paper_size', label: '纸张尺寸' },
      { key: 'layout', label: '每面多页' },
      { key: 'print_range', label: '页面范围' },
    ];
    document.getElementById('optionsList').innerHTML = optNames.map(o => `
      <div class="price-row">
        <span>${o.label}</span>
        <div class="toggle-switch ${options[o.key] !== false ? 'on' : ''}" data-key="${o.key}" onclick="toggleOption(this)"></div>
      </div>
    `).join('');

    document.getElementById('defaultPaper').value = defaults.paper_size || 'A4';
    document.getElementById('defaultColor').value = defaults.color_mode || 'bw';
    document.getElementById('defaultDuplex').value = defaults.duplex || 'single';
    document.getElementById('defaultCopies').value = defaults.copies || 1;

    const hours = shop.business_hours || {};
    document.getElementById('bizOpen').value = hours.open || '08:00';
    document.getElementById('bizClose').value = hours.close || '22:00';
    const qs = shop.queue_settings || {};
    document.getElementById('maxQueue').value = qs.max_queue || 20;
  } catch (err) { showToast('加载选项失败', 'error'); }
}

function toggleOption(el) {
  el.classList.toggle('on');
}

async function saveOptions() {
  const toggles = document.querySelectorAll('#optionsList .toggle-switch');
  const options = {};
  toggles.forEach(t => { options[t.dataset.key] = t.classList.contains('on'); });
  try {
    await api.updateOptions(options);
    showToast('选项已保存');
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

async function saveDefaults() {
  const defaults = {
    paper_size: document.getElementById('defaultPaper').value,
    color_mode: document.getElementById('defaultColor').value,
    duplex: document.getElementById('defaultDuplex').value,
    copies: parseInt(document.getElementById('defaultCopies').value) || 1,
  };
  try {
    await api.updateDefaults(defaults);
    showToast('默认值已保存');
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

async function saveShopConfig() {
  try {
    await api.updateShopConfig({
      business_hours: { open: document.getElementById('bizOpen').value, close: document.getElementById('bizClose').value },
      queue_settings: { max_queue: parseInt(document.getElementById('maxQueue').value) || 20, auto_cancel_hours: 48 },
    });
    showToast('营业设置已保存');
  } catch (err) { showToast('保存失败: ' + err.message, 'error'); }
}

async function loadStats() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const daily = await api.getDailyStats(today);
    const breakdown = daily.breakdown || [];
    document.getElementById('statsBreakdown').innerHTML = breakdown.length === 0
      ? '<div class="empty-state">暂无数据</div>'
      : breakdown.map(b => `<div class="price-row"><span>${b.color_mode} ${b.paper_size} ${b.duplex}</span><span>${b.count}单 · ¥${parseFloat(b.revenue).toFixed(2)}</span></div>`).join('');

    const hourly = await api.request(`/stats/hourly?date=${today}`);
    const hours = hourly.hourly || [];
    document.getElementById('statsHourly').innerHTML = hours.length === 0
      ? '<div class="empty-state">暂无数据</div>'
      : hours.map(h => `<div class="price-row"><span>${h.hour}:00 - ${h.hour + 1}:00</span><span>${h.count} 单</span></div>`).join('');
  } catch (err) { showToast('加载统计失败', 'error'); }
}

initOwner();
