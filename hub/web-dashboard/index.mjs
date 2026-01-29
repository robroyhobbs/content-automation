#!/usr/bin/env node
/**
 * Web Dashboard Server for Content Automation Hub
 * Run with: npm run web
 */

import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch, existsSync } from 'node:fs';
import apiRoutes from './api/routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3847;
const DATA_DIR = join(__dirname, '..', '..', 'data');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// SSE clients for live updates
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  sseClients.add(res);

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Broadcast state change to all SSE clients
function broadcastStateChange(type = 'state-change') {
  const message = JSON.stringify({ type, timestamp: Date.now() });
  sseClients.forEach(client => {
    client.write(`data: ${message}\n\n`);
  });
}

// Watch data files for changes
const filesToWatch = ['state.json', 'history.json', 'reviews.json'];

filesToWatch.forEach(filename => {
  const filepath = join(DATA_DIR, filename);
  if (existsSync(filepath)) {
    watch(filepath, (eventType) => {
      if (eventType === 'change') {
        broadcastStateChange(filename.replace('.json', '-change'));
      }
    });
  }
});

// Serve index.html for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           Content Automation Hub - Web Dashboard           ║
╠════════════════════════════════════════════════════════════╣
║  Dashboard running at: http://localhost:${PORT}              ║
║  Press Ctrl+C to stop                                      ║
╚════════════════════════════════════════════════════════════╝
`);
});
