let appState = {
  currentPage: 'login',
  pageHistory: [],
  orderId: null,
  orderNo: null,
  fileInfo: null,
  previewUrls: [],
  previewTruncated: false,
  previewTotalPages: 0,
  currentPageIdx: 0,
  selectedFormat: 'original',
  contentScale: 100,       // 内容占纸张百分比
  scaleMode: 'fit',        // 'fit' | '100' | 'custom'
  autoMargin: true,         // 自适应边距
  pdfDoc: null,             // PDF.js 文档对象
  config: {
    paperSize: 'A4', colorMode: 'bw', printRange: '',
    copies: 1, duplex: 'single', layout: '1in1', binding: 'none',
  },
  priceResult: null,
  configMeta: null,
  trackTimer: null,
};

// ==================== Toast & Navigation ====================

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast toast-' + (type || 'success');
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2500);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + name);
  if (page) page.classList.add('active');

  document.getElementById('navBar').style.display = name === 'login' ? 'none' : 'flex';
  document.getElementById('navTitle').textContent = {
    home: '自助打印', preview: '排版预览', config: '打印设置',
    'quick-config': '打印设置', track: '订单跟踪', history: '历史订单',
    uploading: '上传中',
  }[name] || '';

  appState.pageHistory.push(appState.currentPage);
  appState.currentPage = name;

  if (name === 'track' && appState.orderId) loadTrackPage();
  if (name === 'history') loadHistoryPage();
  if (name === 'home') loadHomePage();
  if (name === 'config') initConfigPage();
}

function goBack() {
  const prev = appState.pageHistory.pop() || 'home';
  if (appState.currentPage === 'track') clearTrackTimer();
  showPage(prev);
}

// ==================== Login ====================

async function doLogin() {
  const nickname = document.getElementById('loginNickname').value.trim()
    || '用户' + Math.random().toString(36).slice(2, 6);
  try {
    const data = await api.login(nickname);
    document.getElementById('homeNickname').textContent = data.customer.nickname;
    api.connectWS();
    api.onWs('order_update', (d) => {
      if (d.order_id === appState.orderId) loadTrackPage();
    });
    api.onWs('queue_update', () => {
      if (appState.currentPage === 'track') refreshTrackQueue();
    });
    if (data.isStaff || data.isOwner) {
      window.location.href = data.isOwner ? '/owner.html' : '/staff.html';
      return;
    }
    showPage('home');
    loadHomePage();
  } catch (err) {
    showToast('登录失败: ' + err.message, 'error');
  }
}

async function loadHomePage() {
  try {
    const orders = await api.getMyOrders(1);
    const active = orders.list.find(o => ['paid', 'printing'].includes(o.status));
    if (active) {
      appState.orderId = active.id;
      document.getElementById('homeCurrentOrder').style.display = 'block';
      const statusMap = { paid: '排队中', printing: '打印中' };
      document.getElementById('homeOrderStatus').textContent =
        `#${active.id} ${active.file_name} - ${statusMap[active.status] || active.status}`;
    } else {
      document.getElementById('homeCurrentOrder').style.display = 'none';
    }
  } catch (e) {}
  appState.fileInfo = null;
  appState.priceResult = null;
}

function viewCurrentOrder() {
  if (appState.orderId) showPage('track');
}

// ==================== Upload ====================

async function onFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  showPage('uploading');
  document.getElementById('uploadStatus').textContent = '正在上传并解析...';
  try {
    const data = await api.uploadFile(file);
    appState.fileInfo = data;
    appState.previewUrls = data.preview_urls || [];
    appState.previewTruncated = data.preview_truncated || false;
    appState.previewTotalPages = data.preview_total_pages || data.file_pages;
    appState.currentPageIdx = 0;
    appState.selectedFormat = 'original';

    // Populate quick config
    document.getElementById('qcFileName').textContent = data.file_name;
    document.getElementById('qcFileInfo').textContent =
      `${data.file_pages} 页 · ${formatFileSize(data.file_size)}`;

    // Reset quick config options
    document.querySelectorAll('#qcPaperSize .option-btn').forEach(b => b.classList.toggle('active', b.dataset.val === 'A4'));
    document.querySelectorAll('#qcColor .option-btn').forEach(b => b.classList.toggle('active', b.dataset.val === 'bw'));
    document.getElementById('qcPrintRange').value = '';
    appState.config.paperSize = 'A4';
    appState.config.colorMode = 'bw';
    appState.config.printRange = '';

    bindOptionGroup('qcPaperSize', 'paperSize');
    bindOptionGroup('qcColor', 'colorMode');

    showPage('quick-config');
  } catch (err) {
    showToast('上传失败: ' + err.message, 'error');
    showPage('home');
  }
  e.target.value = '';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function bindOptionGroup(groupId, configKey) {
  document.querySelectorAll('#' + groupId + ' .option-btn').forEach(b => {
    b.onclick = function() {
      this.parentElement.querySelectorAll('.option-btn').forEach(x => x.classList.remove('active'));
      this.classList.add('active');
      appState.config[configKey] = this.dataset.val;
    };
  });
}

// ==================== Quick Config → Preview ====================

async function goToPreview() {
  appState.config.printRange = document.getElementById('qcPrintRange').value.trim() || '';

  document.getElementById('pvFileName').textContent = appState.fileInfo.file_name;
  document.getElementById('pvConfig').textContent =
    `${appState.config.paperSize} · ${appState.config.colorMode === 'bw' ? '黑白' : '彩色'}` +
    (appState.config.printRange ? ` · 第${appState.config.printRange}页` : ' · 全部');

  showPage('preview');
  loadPreviewPage();
}

function loadPreviewPage() {
  document.getElementById('pvLoading').style.display = 'block';
  document.getElementById('pvError').style.display = 'none';
  document.getElementById('pvPaperSheet').style.display = 'none';
  document.getElementById('pvScaleBar').style.display = 'none';
  document.getElementById('pvNav').style.display = 'none';
  document.getElementById('pvDots').innerHTML = '';
  appState.pdfDoc = null;

  if (!appState.previewUrls || appState.previewUrls.length === 0) {
    generatePreviewFromUpload();
  } else {
    initPdfJs().then(() => updatePreviewDisplay());
  }
}

async function initPdfJs() {
  if (typeof pdfjsLib === 'undefined') {
    console.warn('PDF.js not loaded');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function retryPreview() { loadPreviewPage(); }

function showPreviewError(msg) {
  document.getElementById('pvLoading').style.display = 'none';
  document.getElementById('pvError').style.display = 'block';
  document.getElementById('pvErrorMsg').textContent = msg;
  document.getElementById('pvPaperSheet').style.display = 'none';
  document.getElementById('pvScaleBar').style.display = 'none';
  document.getElementById('pvNav').style.display = 'none';
}

async function generatePreviewFromUpload() {
  try {
    const order = await api.createOrder({
      file_id: appState.fileInfo.file_id, file_name: appState.fileInfo.file_name,
      file_pages: appState.fileInfo.file_pages, color_mode: appState.config.colorMode,
      duplex: 'single', paper_size: appState.config.paperSize, copies: 1,
      layout: '1in1', binding: 'none', print_range: appState.config.printRange || null,
      total_amount: 0,
    });
    const data = await api.formatOrder(order.order_id);
    appState.previewUrls = data.preview_urls || [];
    appState.previewTruncated = data.preview_truncated || false;
    appState.previewTotalPages = data.preview_total_pages || appState.previewUrls.length;
    appState.selectedFormat = 'formatted';
    appState.orderId = order.order_id;
    await initPdfJs();
    updatePreviewDisplay();
  } catch (err) {
    showPreviewError('预览生成失败: ' + (err.message || '请重试'));
  }
}

async function updatePreviewDisplay() {
  if (!appState.previewUrls || appState.previewUrls.length === 0) {
    showPreviewError('暂无预览内容');
    return;
  }

  // Truncation warning
  const truncEl = document.getElementById('pvTruncWarn');
  if (appState.previewTruncated) {
    truncEl.style.display = 'block';
    truncEl.textContent = `⚠ 仅显示前 ${appState.previewUrls.length} 页预览（共 ${appState.previewTotalPages} 页）`;
  } else { truncEl.style.display = 'none'; }

  // Show paper & scale bar
  document.getElementById('pvLoading').style.display = 'none';
  document.getElementById('pvError').style.display = 'none';
  document.getElementById('pvPaperSheet').style.display = 'block';
  document.getElementById('pvScaleBar').style.display = 'block';

  // Update scale UI
  updateScaleUI();

  // Render page as canvas via PDF.js
  await renderPageToCanvas();

  // Navigation
  const nav = document.getElementById('pvNav');
  nav.style.display = 'flex';
  const total = appState.previewTruncated ? appState.previewTotalPages : appState.previewUrls.length;
  document.getElementById('pvIndicator').textContent = `${appState.currentPageIdx + 1} / ${total}`;
  document.getElementById('pvTotalPages').textContent = total;
  document.getElementById('pvBtnPrev').disabled = appState.currentPageIdx === 0;
  document.getElementById('pvBtnNext').disabled = appState.currentPageIdx >= appState.previewUrls.length - 1;

  const dots = document.getElementById('pvDots');
  if (appState.previewUrls.length <= 20) {
    dots.innerHTML = appState.previewUrls.map((_, i) =>
      `<span class="page-dot${i === appState.currentPageIdx ? ' active' : ''}" onclick="pvGoTo(${i})"></span>`
    ).join('');
  } else {
    dots.innerHTML = `<span style="font-size:11px;color:var(--gray-500)">${appState.previewUrls.length}页预览</span>`;
  }
}

async function renderPageToCanvas() {
  const url = appState.previewUrls[appState.currentPageIdx];
  const canvas = document.getElementById('pvCanvas');
  if (!canvas) return;

  if (url.endsWith('.pdf') && typeof pdfjsLib !== 'undefined') {
    try {
      const pdf = await pdfjsLib.getDocument(url).promise;
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 2.0 }); // 2x for retina
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      document.getElementById('pvContent').style.display = 'block';
      return;
    } catch (e) {
      console.error('PDF.js render failed:', e.message);
    }
  }

  // Fallback for images
  if (!url.endsWith('.pdf')) {
    const img = new Image();
    img.onload = function() {
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.getContext('2d').drawImage(img, 0, 0);
    };
    img.src = url;
  }
}

// ==================== Content Scale ====================

function updateScaleUI() {
  document.getElementById('btnScaleFit').classList.toggle('active', appState.scaleMode === 'fit');
  document.getElementById('btnScale100').classList.toggle('active', appState.scaleMode === '100');
  document.getElementById('btnScaleCustom').classList.toggle('active', appState.scaleMode === 'custom');
  document.getElementById('pvCustomScale').style.display = appState.scaleMode === 'custom' ? 'flex' : 'none';
  document.getElementById('pvScalePct').textContent = appState.contentScale + '%';
  document.getElementById('btnAutoMargin').classList.toggle('active', appState.autoMargin);
  applyContentScale();
}

function applyContentScale() {
  const content = document.getElementById('pvContent');
  if (!content) return;

  let scale;
  if (appState.scaleMode === 'fit') {
    scale = 95; // Fit to paper with small margin
    appState.contentScale = scale;
  } else if (appState.scaleMode === '100') {
    scale = 100;
    appState.contentScale = 100;
  } else {
    scale = appState.contentScale;
  }

  content.style.width = scale + '%';
  content.style.height = scale + '%';

  if (appState.autoMargin) {
    content.style.top = '50%';
    content.style.left = '50%';
    content.style.transform = 'translate(-50%, -50%)';
    content.style.margin = '0';
  } else {
    content.style.top = '0';
    content.style.left = '0';
    content.style.transform = 'none';
    content.style.margin = '2%';
  }
}

function pvScaleMode(mode) {
  appState.scaleMode = mode;
  if (mode === 'fit') appState.contentScale = 95;
  if (mode === '100') appState.contentScale = 100;
  updateScaleUI();
}

function pvScaleDelta(delta) {
  appState.scaleMode = 'custom';
  appState.contentScale = Math.max(10, Math.min(200, appState.contentScale + delta));
  updateScaleUI();
}

function pvToggleMargin() {
  appState.autoMargin = !appState.autoMargin;
  updateScaleUI();
}

// ==================== Page navigation ====================

function pvPrev() {
  if (appState.currentPageIdx > 0) { appState.currentPageIdx--; updatePreviewDisplay(); }
}

function pvNext() {
  if (appState.currentPageIdx < appState.previewUrls.length - 1) { appState.currentPageIdx++; updatePreviewDisplay(); }
}

function pvGoTo(idx) {
  appState.currentPageIdx = idx;
  updatePreviewDisplay();
}

async function formatDocument() {
  const btn = document.getElementById('btnFormatDoc');
  const status = document.getElementById('pvFormatStatus');
  btn.disabled = true; btn.textContent = '处理中...';
  status.style.display = 'block';
  status.textContent = '正在转标准PDF，请稍候...';
  status.style.color = 'var(--warning)'; status.style.background = '#fef3c7';

  try {
    let orderId = appState.orderId;
    if (!orderId) {
      const order = await api.createOrder({
        file_id: appState.fileInfo.file_id,
        file_name: appState.fileInfo.file_name,
        file_pages: appState.fileInfo.file_pages,
        color_mode: appState.config.colorMode, duplex: 'single',
        paper_size: appState.config.paperSize, copies: 1,
        layout: '1in1', binding: 'none',
        print_range: appState.config.printRange || null,
        total_amount: 0,
      });
      orderId = order.order_id;
    }

    const data = await api.formatOrder(orderId);
    appState.previewUrls = data.preview_urls || [];
    appState.previewTruncated = data.preview_truncated || false;
    appState.previewTotalPages = data.preview_total_pages || appState.previewUrls.length;
    appState.currentPageIdx = 0;
    appState.selectedFormat = 'formatted';
    appState.orderId = orderId;

    status.textContent = '✅ 排版已处理为标准PDF';
    status.style.color = '#065f46'; status.style.background = '#d1fae5';
    updatePreviewDisplay();
  } catch (err) {
    status.textContent = '处理失败: ' + err.message;
    status.style.color = '#991b1b'; status.style.background = '#fee2e2';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔧 排版有问题？一键转标准PDF';
  }
}

// ==================== Preview → Config ====================

async function confirmFromPreview() {
  try {
    appState.configMeta = await api.getCustomerConfig();
  } catch (e) { appState.configMeta = {}; }

  const options = appState.configMeta?.options || {};
  const defaults = appState.configMeta?.defaults || {};

  document.getElementById('groupDuplex').style.display = options.duplex !== false ? '' : 'none';
  document.getElementById('groupBinding').style.display = options.binding !== false ? '' : 'none';

  appState.config.copies = defaults.copies || 1;
  appState.config.duplex = defaults.duplex || 'single';
  appState.config.layout = '1in1';
  appState.config.binding = defaults.binding || 'none';
  document.getElementById('copiesDisplay').textContent = appState.config.copies;

  document.querySelectorAll('#optDuplex .option-btn').forEach(b => b.classList.toggle('active', b.dataset.val === appState.config.duplex));
  document.querySelectorAll('#optLayout .option-btn').forEach(b => b.classList.toggle('active', b.dataset.val === appState.config.layout));
  document.querySelectorAll('#optBinding .option-btn').forEach(b => b.classList.toggle('active', b.dataset.val === appState.config.binding));

  bindOptionGroup('optDuplex', 'duplex');
  bindOptionGroup('optLayout', 'layout');
  bindOptionGroup('optBinding', 'binding');

  showPage('config');
}

async function initConfigPage() {
  document.getElementById('cfgSummary').textContent =
    `${appState.config.paperSize} · ${appState.config.colorMode === 'bw' ? '黑白' : '彩色'}` +
    (appState.config.printRange ? ` · 第${appState.config.printRange}页` : '');
  await calcAndShowPrice();
}

function changeCopies(delta) {
  appState.config.copies = Math.max(1, appState.config.copies + delta);
  document.getElementById('copiesDisplay').textContent = appState.config.copies;
  calcAndShowPrice();
}

async function calcAndShowPrice() {
  if (!appState.fileInfo) return;
  try {
    const params = {
      file_pages: appState.fileInfo.file_pages,
      color_mode: appState.config.colorMode,
      duplex: appState.config.duplex,
      paper_size: appState.config.paperSize,
      copies: appState.config.copies,
      layout: appState.config.layout,
      binding: appState.config.binding,
      print_range: appState.config.printRange || null,
    };
    const result = await api.calcPrice(params);
    appState.priceResult = result;
    document.getElementById('priceDisplay').textContent = '¥ ' + result.total_amount.toFixed(2);
    document.getElementById('priceDetail').textContent =
      result.price_breakdown.items.map(i => i.label + ': ¥' + i.amount).join(' | ');
    const waitMin = Math.ceil((result.estimated_seconds || 0) / 60);
    document.getElementById('waitEstimate').textContent = waitMin > 0 ? `预计处理约 ${waitMin} 分钟` : '';
  } catch (err) {
    console.error('计价失败:', err);
  }
}

// ==================== Submit Order ====================

async function submitOrder() {
  if (!appState.priceResult) return;
  const btn = document.getElementById('btnSubmit');
  btn.disabled = true;
  btn.textContent = '提交中...';

  try {
    const order = await api.createOrder({
      file_id: appState.fileInfo.file_id,
      file_name: appState.fileInfo.file_name,
      file_pages: appState.fileInfo.file_pages,
      format_version: appState.selectedFormat,
      color_mode: appState.config.colorMode,
      duplex: appState.config.duplex,
      paper_size: appState.config.paperSize,
      copies: appState.config.copies,
      layout: appState.config.layout,
      binding: appState.config.binding,
      print_range: appState.config.printRange || null,
      content_scale: appState.contentScale,
      total_amount: appState.priceResult.total_amount,
    });

    appState.orderId = order.order_id;
    appState.orderNo = order.order_no;

    showToast('订单已提交，请到前台付款');
    showPage('track');
  } catch (err) {
    showToast('提交失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💳 提交订单并支付';
  }
}

// ==================== Track ====================

async function loadTrackPage() {
  if (!appState.orderId) return;
  try {
    const order = await api.getOrder(appState.orderId);
    document.getElementById('trackOrderNo').textContent = order.order_no || '--';

    const statusMap = { pending_pay: 0, paid: 1, printing: 2, completed: 3, picked: 4 };
    const stepIdx = statusMap[order.status] || 0;
    ['stepPay', 'stepPaid', 'stepPrint', 'stepDone'].forEach((id, i) => {
      const el = document.getElementById(id);
      el.classList.remove('active', 'done');
      if (i < stepIdx) el.classList.add('done');
      if (i === stepIdx) el.classList.add('active');
    });

    if (order.status === 'pending_pay') {
      document.getElementById('queueStatus').style.display = 'block';
      document.getElementById('queuePosition').textContent = '💳';
      document.getElementById('queueTime').textContent = '请到前台付款确认';
      clearTrackTimer();
    } else if (order.status === 'paid') {
      document.getElementById('queueStatus').style.display = 'block';
      document.getElementById('queueTime').textContent = '正在计算...';
      refreshTrackQueue();
      startTrackTimer();
    } else if (order.status === 'printing') {
      document.getElementById('queueStatus').style.display = 'block';
      document.getElementById('queuePosition').textContent = '...';
      document.getElementById('queueTime').textContent = '正在打印中';
      clearTrackTimer();
    } else {
      document.getElementById('queueStatus').style.display = 'none';
      clearTrackTimer();
    }

    if (order.status === 'completed') {
      showToast('您的文件已打印完成，请取件！');
      clearTrackTimer();
    }

    document.getElementById('trackDetail').textContent =
      `${order.file_name} | ${order.paper_size} ${order.color_mode === 'bw' ? '黑白' : '彩色'} ${order.duplex === 'double' ? '双面' : '单面'} | ${order.copies}份 | ¥${order.total_amount}`;
  } catch (err) {
    console.error('加载订单失败:', err);
  }
}

async function refreshTrackQueue() {
  try {
    const q = await api.getWaitingTime(appState.orderId);
    document.getElementById('queuePosition').textContent = q.position || 0;
    document.getElementById('queueTime').textContent = q.wait_display;
  } catch (e) {}
}

function startTrackTimer() {
  clearTrackTimer();
  appState.trackTimer = setInterval(refreshTrackQueue, 10000);
}

function clearTrackTimer() {
  if (appState.trackTimer) { clearInterval(appState.trackTimer); appState.trackTimer = null; }
}

// ==================== History ====================

async function loadHistoryPage() {
  try {
    const orders = await api.getMyOrders(1);
    const container = document.getElementById('historyList');
    if (orders.list.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无订单记录</div>';
      return;
    }
    const statusNames = { pending_pay: '待支付', paid: '排队中', printing: '打印中', completed: '已完成', picked: '已取件', cancelled: '已取消' };
    container.innerHTML = orders.list.map(o => `
      <div class="card order-card" style="cursor:pointer" onclick="viewHistoryOrder(${o.id})">
        <div>
          <div style="font-weight:600;font-size:14px">${o.file_name}</div>
          <div style="font-size:12px;color:var(--gray-500)">${o.paper_size || ''} ${o.color_mode === 'bw' ? '黑白' : '彩色'} · ${o.copies}份</div>
          <div style="font-size:12px;color:var(--gray-400)">${o.created_at ? new Date(o.created_at).toLocaleString() : ''}</div>
        </div>
        <div style="text-align:right">
          <span class="badge badge-${o.status}">${statusNames[o.status] || o.status}</span>
          <div style="font-size:16px;font-weight:700;margin-top:4px">¥${parseFloat(o.total_amount).toFixed(2)}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('加载历史订单失败:', err);
  }
}

function viewHistoryOrder(id) {
  appState.orderId = id;
  showPage('track');
}

// ==================== Init ====================
async function quickLogin(role) {
  const names = { customer: '顾客A', staff: 'staff', owner: 'owner' };
  document.getElementById('loginNickname').value = names[role] || '顾客';
  await doLogin();
}

showPage('login');
