# 🧬 OncoClear — Cancer Detection App

## 🚨 Fix: "Cannot connect to server"

This error means one of three things:
1. The backend is not running → **start it** (see below)
2. MongoDB is not running → **start it** (see below)  
3. You opened `auth.html` directly as a file → **use http://localhost:5000/auth.html instead**

---

## ⚡ Correct Way to Run (Everything on port 5000)

The Express backend now **serves the frontend files too** — so there are zero CORS issues.

### Step 1 — Start MongoDB

```bash
# macOS
brew services start mongodb-community

# Ubuntu / WSL
sudo systemctl start mongod

# Windows (run as admin)
net start MongoDB

# Verify it's running:
mongosh --eval "db.runCommand({ connectionStatus: 1 })"
```

### Step 2 — Start the backend

```bash
cd backend
npm install
node server.js
```

You should see:
```
✅  MongoDB connected → mongodb://127.0.0.1:27017/oncoclear
🧬  OncoClear running on  http://localhost:5000
🌐  Frontend:  http://localhost:5000/auth.html
```

### Step 3 — Open the app

👉 **http://localhost:5000/auth.html**

> ❌ Do NOT open the HTML files directly from your file system (file://...)  
> ✅ Always use http://localhost:5000/auth.html

---

## 📁 Project Structure

```
cancer-detect/
├── backend/
│   ├── server.js     ← Express API + serves frontend + Mongoose models
│   ├── package.json
│   ├── .env          ← Edit MONGO_URI and JWT_SECRET here
│   └── uploads/      ← Uploaded prescriptions stored here (auto-created)
│
└── frontend/
    ├── auth.html     ← Login & Signup
    └── dashboard.html← Main app with history table
```

---

## 🔧 .env Configuration

Edit `backend/.env`:

```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/oncoclear
JWT_SECRET=change_this_to_a_long_random_string
FRONTEND_URL=http://localhost:5000
```

**MongoDB Atlas (cloud, free tier):**
```env
MONGO_URI=mongodb+srv://username:password@cluster.xxxxx.mongodb.net/oncoclear
```

---

## 🗄️ Database Collections

**users** — one document per account
```js
{ name, email, password (bcrypt), role, createdAt }
```

**prescriptions** — one per uploaded file
```js
{ userId, fileName, storedName, filePath, fileSize, mimeType, status, aiResult, uploadedAt }
```

---

## 🔐 API Endpoints

| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | ❌ | Server + DB status |
| POST | `/api/auth/register` | ❌ | Register new user |
| POST | `/api/auth/login` | ❌ | Login → JWT |
| GET | `/api/auth/profile` | ✅ | Current user |
| POST | `/api/prescription/upload` | ✅ | Upload file |
| GET | `/api/prescription/history` | ✅ | User's uploads |
| GET | `/api/prescription/:id` | ✅ | Single record |
| DELETE | `/api/prescription/:id` | ✅ | Delete record |

Test health: http://localhost:5000/api/health

---

## 🤖 Plug in Your AI Model

In `server.js`, find this comment block inside the upload route:

```js
// ── Plug AI model here ──
// const result = await yourModel.analyze(req.file.path);
// rx.aiResult = result; rx.status = 'completed'; await rx.save();
```

Replace with your actual model call. The file is saved at `req.file.path`.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `MongoDB connection FAILED` | Start MongoDB (`brew services start mongodb-community` / `sudo systemctl start mongod`) |
| `Cannot connect to server` | Make sure `node server.js` is running in the backend folder |
| Page not loading | Use `http://localhost:5000/auth.html` — not a `file://` path |
| Port already in use | Change `PORT=5001` in `.env` and visit `http://localhost:5001/auth.html` |
| EADDRINUSE error | Kill the existing process: `lsof -ti:5000 | xargs kill` |
