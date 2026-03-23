require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app = express();
const PORT       = process.env.PORT       || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'oncoclear_dev_secret_change_in_prod';
const DB_PATH = path.join(__dirname, 'db.json');
let dbConnected = false;

const defaultDb = () => ({
  users: [],
  prescriptions: [],
  counters: { user: 0, prescription: 0 }
});

const ensureDbFile = () => {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb(), null, 2), 'utf8');
  }
};

const readDb = () => {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  const parsed = JSON.parse(raw || '{}');

  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    prescriptions: Array.isArray(parsed.prescriptions) ? parsed.prescriptions : [],
    counters: {
      user: Number(parsed?.counters?.user || 0),
      prescription: Number(parsed?.counters?.prescription || 0)
    }
  };
};

const writeDb = (db) => {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
};

const connectLocalDb = () => {
  try {
    ensureDbFile();
    readDb();
    dbConnected = true;
    console.log(`✅  Local DB connected → ${DB_PATH}`);
  } catch (err) {
    dbConnected = false;
    console.error('❌  Local DB connection FAILED:', err.message);
  }
};

connectLocalDb();

// ─── Middleware ───────────────────────────────────────────────────────────────
// Allow all origins during dev — tighten in production
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve current project folder as static files ─────────────────────────────
// This means auth.html & dashboard.html are reachable at:
//   http://localhost:5000/auth.html
//   http://localhost:5000/dashboard.html
// And all fetch() calls go to the same origin -> zero CORS problems.
const frontendPath = __dirname;
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log(`🌐  Serving frontend from: ${frontendPath}`);
} else {
  console.warn('Static frontend folder not found - skipping static serve');
}

app.get('/', (req, res) => {
  res.redirect('/auth.html');
});

// ─── Upload Directory ─────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `rx-${unique}${path.extname(file.originalname)}`);
  }
});
const fileFilter = (req, file, cb) => {
  const ok = ['image/jpeg','image/jpg','image/png','application/pdf'];
  ok.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPEG, PNG or PDF allowed'), false);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Auth Middleware ──────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token' });
    req.user = decoded;
    next();
  });
};

// Return a clear status when DB-dependent APIs are called before DB is ready.
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (!dbConnected) {
    return res.status(503).json({
      success: false,
      message: 'Database is not connected. Check db.json and retry.'
    });
  }
  next();
});

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health + DB status
app.get('/api/health', (req, res) => {
  res.json({
    success:   true,
    api:       'OncoClear running',
    database:  dbConnected ? 'connected' : 'disconnected',
    timestamp: new Date()
  });
});

// ── REGISTER ─────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const cleanEmail = email?.toLowerCase().trim();

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email format' });

    const db = readDb();
    const existing = db.users.find((u) => u.email === cleanEmail);
    if (existing)
      return res.status(409).json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    db.counters.user += 1;
    const user = {
      id: String(db.counters.user),
      name: name.trim(),
      email: cleanEmail,
      password: hashed,
      role: role || 'patient',
      created_at: new Date().toISOString()
    };
    db.users.push(user);
    writeDb(db);

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, message: 'Account created', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });

  } catch (err) {
    console.error('Register:', err.message);
    if (String(err.message).toLowerCase().includes('duplicate') || String(err.message).toLowerCase().includes('unique')) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const db = readDb();
    const user = db.users.find((u) => u.email === email.toLowerCase().trim());
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: 'Login successful', token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });

  } catch (err) {
    console.error('Login:', err.message);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// ── PROFILE ───────────────────────────────────────────────────────────────────
app.get('/api/auth/profile', auth, async (req, res) => {
  try {
    const db = readDb();
    const user = db.users.find((u) => u.id === String(req.user.id));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        created_at: user.created_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── UPLOAD PRESCRIPTION ───────────────────────────────────────────────────────
app.post('/api/prescription/upload', auth, upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const db = readDb();
    db.counters.prescription += 1;
    const rx = {
      id: String(db.counters.prescription),
      user_id: String(req.user.id),
      file_name: req.file.originalname,
      stored_name: req.file.filename,
      file_path: req.file.path,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      status: 'pending_analysis',
      ai_result: null,
      uploaded_at: new Date().toISOString()
    };
    db.prescriptions.push(rx);
    writeDb(db);

    // ── Plug AI model here ────────────────────────────────────────────────
    // const result = await yourModel.analyze(req.file.path);
    // rx.aiResult = result; rx.status = 'completed'; await rx.save();
    // ─────────────────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: 'Prescription saved to database',
      prescription: { id: rx.id, fileName: rx.file_name, status: rx.status, uploadedAt: rx.uploaded_at },
      analysis: { analyzed: false, message: 'AI model not connected yet - file stored in db.json.' }
    });
  } catch (err) {
    console.error('Upload:', err.message);
    if (err.message.includes('allowed')) return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: 'Server error during upload' });
  }
});

// ── PRESCRIPTION HISTORY ──────────────────────────────────────────────────────
app.get('/api/prescription/history', auth, async (req, res) => {
  try {
    const db = readDb();
    const list = db.prescriptions
      .filter((p) => p.user_id === String(req.user.id))
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));

    const prescriptions = list.map((p) => ({
      _id: p.id,
      userId: p.user_id,
      fileName: p.file_name,
      fileSize: p.file_size,
      mimeType: p.mime_type,
      status: p.status,
      aiResult: p.ai_result,
      uploadedAt: p.uploaded_at
    }));

    res.json({ success: true, count: prescriptions.length, prescriptions });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── SINGLE PRESCRIPTION ───────────────────────────────────────────────────────
app.get('/api/prescription/:id', auth, async (req, res) => {
  try {
    const db = readDb();
    const rx = db.prescriptions.find((p) => p.id === String(req.params.id) && p.user_id === String(req.user.id));
    if (!rx) return res.status(404).json({ success: false, message: 'Not found' });

    res.json({
      success: true,
      prescription: {
        _id: rx.id,
        userId: rx.user_id,
        fileName: rx.file_name,
        storedName: rx.stored_name,
        filePath: rx.file_path,
        fileSize: rx.file_size,
        mimeType: rx.mime_type,
        status: rx.status,
        aiResult: rx.ai_result,
        uploadedAt: rx.uploaded_at
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── DELETE PRESCRIPTION ───────────────────────────────────────────────────────
app.delete('/api/prescription/:id', auth, async (req, res) => {
  try {
    const db = readDb();
    const rxIndex = db.prescriptions.findIndex((p) => p.id === String(req.params.id) && p.user_id === String(req.user.id));
    const rx = rxIndex >= 0 ? db.prescriptions[rxIndex] : null;
    if (!rx) return res.status(404).json({ success: false, message: 'Not found' });

    if (fs.existsSync(rx.file_path)) fs.unlinkSync(rx.file_path);

    db.prescriptions.splice(rxIndex, 1);
    writeDb(db);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: ALL USERS ──────────────────────────────────────────────────────────
app.get('/api/admin/users', auth, async (req, res) => {
  if (!['doctor','researcher'].includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Access denied' });
  try {
    const db = readDb();
    const users = db.users
      .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ success: true, count: users.length, users });
  } catch (err) {
    console.error('Admin users:', err.message);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled:', err.message);
  res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🧬  OncoClear running on  http://localhost:${PORT}`);
  console.log(`🔑  Auth:      POST http://localhost:${PORT}/api/auth/login`);
  console.log(`📋  Health:    GET  http://localhost:${PORT}/api/health`);
  console.log(`🌐  Frontend:  http://localhost:${PORT}/auth.html\n`);
});

module.exports = app;
