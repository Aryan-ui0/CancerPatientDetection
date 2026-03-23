# OncoClear - Cancer Detection App

## Run With Local db.json

This project now uses a local JSON database file, `db.json`.
No Supabase setup is required.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. (Optional) Create `.env` in project root:

```env
PORT=5000
JWT_SECRET=change_this_to_a_long_random_string
```

3. Start server:

```bash
npm start
```

4. Open app:

http://localhost:5000/auth.html

## Important

- Do not open `auth.html` directly using `file://` path.
- Always access through the Express server URL.
- Data is saved to `db.json` in project root.

## Project Structure

```text
CancerPatientDetection/
|- server.js
|- package.json
|- db.json
|- auth.html
|- dashboard.html
|- uploads/
```

## Database Schema (db.json)

```json
{
  "users": [
    {
      "id": "1",
      "name": "Sample User",
      "email": "user@example.com",
      "password": "bcrypt-hash",
      "role": "patient",
      "created_at": "2026-03-23T00:00:00.000Z"
    }
  ],
  "prescriptions": [
    {
      "id": "1",
      "user_id": "1",
      "file_name": "report.pdf",
      "stored_name": "rx-123456789.pdf",
      "file_path": "uploads/rx-123456789.pdf",
      "file_size": 102400,
      "mime_type": "application/pdf",
      "status": "pending_analysis",
      "ai_result": null,
      "uploaded_at": "2026-03-23T00:00:00.000Z"
    }
  ],
  "counters": {
    "user": 1,
    "prescription": 1
  }
}
```

## API Endpoints

- `GET /api/health` : Server and DB status
- `POST /api/auth/register` : Register user
- `POST /api/auth/login` : Login user
- `GET /api/auth/profile` : Logged-in profile
- `POST /api/prescription/upload` : Upload prescription file
- `GET /api/prescription/history` : User upload history
- `GET /api/prescription/:id` : Single upload details
- `DELETE /api/prescription/:id` : Delete upload

## Notes

- Uploaded files are stored in `uploads/`.
- Passwords are hashed with `bcryptjs`.
- Authentication uses JWT.
- `db.json` is suitable for local development and demos.
