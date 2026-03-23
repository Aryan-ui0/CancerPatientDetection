require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Serve static HTML directly (Firebase handles auth + data).
const frontendPath = path.join(__dirname, 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log(`🌐 Serving frontend from: ${frontendPath}`);
} else {
  app.use(express.static(__dirname));
  console.log(`🌐 Serving project root from: ${__dirname}`);
}

app.get('/', (req, res) => res.redirect('/auth.html'));

app.listen(PORT, () => {
  console.log(`🧬 OncoClear running at http://localhost:${PORT}`);
});

module.exports = app;
