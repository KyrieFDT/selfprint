require('dotenv').config();

module.exports = {
  serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
  agentSecret: process.env.AGENT_SECRET || 'agent-dev-secret',
  agentId: process.env.AGENT_ID || 'agent-win-001',
  printerName: process.env.PRINTER_NAME || 'Microsoft Print to PDF',
  pollInterval: parseInt(process.env.POLL_INTERVAL) || 5,
};
