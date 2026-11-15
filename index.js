import express from 'express';
import http from 'http';
import * as wisp from '@mercuryworkshop/wisp-js/server';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Direct, reliable path resolutions for pnpm and npm
const scramjetPath = path.join(__dirname, 'node_modules', '@mercuryworkshop', 'scramjet');
const epoxyPath = path.join(__dirname, 'node_modules', '@mercuryworkshop', 'epoxy-transport');
const baremuxPath = path.join(__dirname, 'node_modules', '@mercuryworkshop', 'bare-mux', 'dist');

// 1. Serve your static frontend files (Claude's template)
app.use(express.static(__dirname));

// 2. Serve the proxy engine scripts to the browser
app.use('/scramjet/', express.static(scramjetPath));
app.use('/epoxy/', express.static(epoxyPath));
app.use('/baremux/', express.static(baremuxPath));

// 3. Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 4. Route WebSocket traffic through Wisp
server.on('upgrade', (req, socket, head) => {
  if (req.url.endsWith('/wisp/')) {
    wisp.routeRequest(req, socket, head);
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 Proxy running successfully on http://localhost:${PORT}`);
});