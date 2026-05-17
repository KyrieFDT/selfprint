const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { printFile } = require('./printer');
const config = require('./config');
const { io } = require('socket.io-client');
const os = require('os');

class PrintAgent {
  constructor() {
    this.jobs = [];
    this.isProcessing = false;
    this.pollTimer = null;
    this.tempDir = path.join(os.tmpdir(), 'print-agent-jobs');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  async start() {
    console.log('[Agent] 打印代理启动');
    console.log(`[Agent] 代理ID: ${config.agentId}`);
    console.log(`[Agent] 打印机: ${config.printerName}`);
    console.log(`[Agent] 服务端: ${config.serverUrl}`);

    await this._scanAndReportPrinters();
    await this._sendHeartbeat();
    this._startHeartbeat();
    this._startPolling();
    this._connectWebSocket();
    this._processNextJob();
  }

  _connectWebSocket() {
    try {
      const wsUrl = config.serverUrl.replace(/^http/, 'ws') + '/ws';
      this.socket = io(wsUrl, {
        query: { token: config.agentSecret },
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionAttempts: 2,
      });

      this.socket.on('connect', () => {
        console.log('[Agent] WebSocket已连接');
      });

      this.socket.on('queue_update', (data) => {
        if (data.type === 'new_order') {
          setTimeout(() => this._fetchJob(), 1000);
        }
      });

      this.socket.on('connect_error', () => {});
      this.socket.on('disconnect', () => {});
    } catch (err) {}
  }

  _startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this._fetchJob(), config.pollInterval * 1000);
    this._fetchJob();
  }

  async _fetchJob() {
    try {
      const resp = await axios.get(`${config.serverUrl}/api/agent/pending-jobs`, {
        headers: { Authorization: `Bearer ${config.agentSecret}` },
        params: { agent_id: config.agentId },
      });

      if (resp.data.success && resp.data.data.has_job) {
        const job = resp.data.data.job;
        if (!this.jobs.find(j => j.id === job.id)) {
          this.jobs.push(job);
          this._processNextJob();
        }
      }
    } catch (err) {}
  }

  async _processNextJob() {
    if (this.isProcessing || this.jobs.length === 0) return;
    this.isProcessing = true;

    const job = this.jobs.shift();
    console.log(`[Agent] 开始打印: #${job.id} ${job.file_name}`);

    try {
      const fileUrl = `${config.serverUrl}/api/files/preview/${job.file_url}`;
      const resp = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${config.agentSecret}` },
      });

      const ext = path.extname(job.file_name);
      const localPath = path.join(this.tempDir, `job_${job.id}_${Date.now()}${ext}`);
      fs.writeFileSync(localPath, Buffer.from(resp.data));

      await printFile(localPath, {
        copies: job.copies || 1,
        colorMode: job.color_mode || 'bw',
        duplex: job.duplex || 'single',
        paperSize: job.paper_size || 'A4',
        layout: job.layout || '1in1',
        contentScale: job.content_scale || 100,
      });

      console.log(`[Agent] 打印完成: #${job.id}`);

      await axios.post(`${config.serverUrl}/api/agent/job-complete`, {
        agent_id: config.agentId, order_id: job.id, success: true,
      }, { headers: { Authorization: `Bearer ${config.agentSecret}` } });

      try { fs.unlinkSync(localPath); } catch (e) {}

    } catch (err) {
      console.error(`[Agent] 打印失败: #${job.id}`, err.message);

      try {
        await axios.post(`${config.serverUrl}/api/agent/job-complete`, {
          agent_id: config.agentId, order_id: job.id,
          success: false, error_message: err.message,
        }, { headers: { Authorization: `Bearer ${config.agentSecret}` } });
      } catch (e) {}
    }

    this.isProcessing = false;
    setTimeout(() => this._processNextJob(), 2000);
  }

  async _sendHeartbeat() {
    try {
      await axios.post(`${config.serverUrl}/api/agent/heartbeat`, {
        agent_id: config.agentId,
        status: this.isProcessing ? 'printing' : 'idle',
      }, { headers: { Authorization: `Bearer ${config.agentSecret}` } });
    } catch (err) {}
  }

  _startHeartbeat() {
    setInterval(() => this._sendHeartbeat(), 30000);
  }

  async _scanAndReportPrinters() {
    try {
      const { listPrinters, getDefaultPrinter } = require('./printer');
      const printers = await listPrinters();
      const defaultName = await getDefaultPrinter();

      if (!printers || printers.length === 0) {
        console.log('[Agent] 未检测到本地打印机');
        return;
      }

      const printerList = Array.isArray(printers)
        ? printers.map(p => ({
            name: typeof p === 'string' ? p : (p.Name || p.name || ''),
            is_default: typeof p === 'string' ? p.includes(defaultName) : (p.Name === defaultName || p.name === defaultName),
          }))
        : [];

      console.log(`[Agent] 检测到 ${printerList.length} 台打印机`);
      await axios.post(`${config.serverUrl}/api/agent/report-printers`, {
        agent_id: config.agentId, printers: printerList,
      }, { headers: { Authorization: `Bearer ${config.agentSecret}` } });
    } catch (err) {}
  }
}

module.exports = new PrintAgent();
