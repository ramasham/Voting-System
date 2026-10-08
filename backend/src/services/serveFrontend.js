const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

function serveFrontend(app, directory) {
  const index = path.join(directory, 'index.html');
  if (!fs.existsSync(index)) {
    throw new Error('Frontend build is missing. Build frontend/dvs before starting the hosted app');
  }
  app.use(express.static(directory, { index: false, dotfiles: 'deny' }));
  app.get(['/', '/admin', '/admin/', '/results', '/results/'], (req, res) => {
    res.sendFile(index, { headers: { 'Cache-Control': 'no-store' } });
  });
}

module.exports = { serveFrontend };
