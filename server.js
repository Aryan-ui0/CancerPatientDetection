require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');

const app = express();
const PORT       = process.env.PORT       || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'oncoclear_dev_secret_change_in_prod';
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://127.0.0.1:27017/oncoclear';

// ─── Mongoose Models ──────────────────────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  name:      { type: String, required: true, trim: true },
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:  { type: String, required: true },
  role:      { type: String, enum: ['patient', 'doctor', 'researcher'], default: 'patient' },
  createdAt: { type: Date, default: Date.now }
});

const PrescriptionSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName:   { type: String, required: true },
  storedName: { type: String, required: true },
  filePath:   { type: String, required: true },
  fileSize:   { type: Number },
  mimeType:   { type: String },
  status:     { type: String, enum: ['pending_analysis','analyzing','completed','failed'], default: 'pending_analysis' },
  aiResult:   { type: mongoose.Schema.Types.Mixed, default: null },
  uploadedAt: { type: Date, default: Date.now }
});

const User         = mongoose.model('User',         UserSchema);
const Prescription = mongoose.model('Prescription', PrescriptionSchema);

// ─── Connect MongoDB ──────────────────────────────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => console.log(`✅  MongoDB connected → ${MONGO_URI}`))
  .catch(err => {
    console.error('❌  MongoDB connection FAILED:', err.message);
    console.error('    → Is mongod running?  Try: sudo systemctl start mongod  OR  brew services start mongodb-community');
    process.exit(1);
  });

// ─── Middleware ───────────────────────────────────────────────────────────────
// Allow all origins during dev — tighten in production
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Serve frontend folder as static files ────────────────────────────────────
// This means auth.html & dashboard.html are reachable at:
//   http://localhost:5000/auth.html
//   http://localhost:5000/dashboard.html
// And all fetch() calls go to the same origin → zero CORS problems.
const frontendPath = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  console.log(`🌐  Serving frontend from: ${frontendPath}`);
} else {
  console.warn('⚠️   frontend/ folder not found next to backend/ — skipping static serve');
}

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

// ─── API Routes ───────────────────────────────────────────────────────────────

// Health + DB status
app.get('/api/health', (req, res) => {
  const dbState = ['disconnected','connected','connecting','disconnecting'];
  res.json({
    success:   true,
    api:       'OncoClear running',
    database:  dbState[mongoose.connection.readyState] || 'unknown',
    timestamp: new Date()
  });
});

// ── REGISTER ─────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });
    if (password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ success: false, message: 'Invalid email format' });

    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ success: false, message: 'Email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = await new User({ name: name.trim(), email: email.toLowerCase().trim(), password: hashed, role: role || 'patient' }).save();

    const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, message: 'Account created', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });

  } catch (err) {
    console.error('Register:', err.message);
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'Email already registered' });
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ success: false, message: 'Invalid email or password' });

    const token = jwt.sign({ id: user._id, email: user.email, name: user.name, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, message: 'Login successful', token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });

  } catch (err) {
    console.error('Login:', err.message);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// ── PROFILE ───────────────────────────────────────────────────────────────────
app.get('/api/auth/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── UPLOAD PRESCRIPTION ───────────────────────────────────────────────────────
app.post('/api/prescription/upload', auth, upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const rx = await new Prescription({
      userId: req.user.id, fileName: req.file.originalname,
      storedName: req.file.filename, filePath: req.file.path,
      fileSize: req.file.size, mimeType: req.file.mimetype
    }).save();

    // ── Plug AI model here ────────────────────────────────────────────────
    // const result = await yourModel.analyze(req.file.path);
    // rx.aiResult = result; rx.status = 'completed'; await rx.save();
    // ─────────────────────────────────────────────────────────────────────

    res.status(201).json({
      success: true,
      message: 'Prescription saved to database',
      prescription: { id: rx._id, fileName: rx.fileName, status: rx.status, uploadedAt: rx.uploadedAt },
      analysis: { analyzed: false, message: 'AI model not connected yet — file stored in DB.' }
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
    const list = await Prescription.find({ userId: req.user.id }).sort({ uploadedAt: -1 }).select('-filePath -storedName');
    res.json({ success: true, count: list.length, prescriptions: list });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── SINGLE PRESCRIPTION ───────────────────────────────────────────────────────
app.get('/api/prescription/:id', auth, async (req, res) => {
  try {
    const rx = await Prescription.findOne({ _id: req.params.id, userId: req.user.id });
    if (!rx) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, prescription: rx });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── DELETE PRESCRIPTION ───────────────────────────────────────────────────────
app.delete('/api/prescription/:id', auth, async (req, res) => {
  try {
    const rx = await Prescription.findOne({ _id: req.params.id, userId: req.user.id });
    if (!rx) return res.status(404).json({ success: false, message: 'Not found' });
    if (fs.existsSync(rx.filePath)) fs.unlinkSync(rx.filePath);
    await rx.deleteOne();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ── ADMIN: ALL USERS ──────────────────────────────────────────────────────────
app.get('/api/admin/users', auth, async (req, res) => {
  if (!['doctor','researcher'].includes(req.user.role))
    return res.status(403).json({ success: false, message: 'Access denied' });
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json({ success: true, count: users.length, users });
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
