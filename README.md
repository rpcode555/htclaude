# ⚡ Hightech Claude — Unlimited Telegram Cloud Storage

> Next-Gen, High-Performance Cloud Storage powered by **[@claudestorage_bot](https://t.me/claudestorage_bot)** & **Telegram Saved Messages**.

---

## 🌟 Overview

**Hightech Claude** transforms Telegram into an unlimited personal Cloud Storage drive.

- 🤖 **Connected Bot**: [@claudestorage_bot](https://t.me/claudestorage_bot) (`ID: 8805033967`)
- 💬 **Saved Messages (MTProto)**: Upload files up to **2 GB** (or 4 GB with Telegram Premium) directly into your private `Saved Messages` chat.
- 🔄 **Two-Way Telegram Sync**:
  - Upload files via the **Web Dashboard** (`http://localhost:3000`).
  - Or simply **send any file directly to [@claudestorage_bot](https://t.me/claudestorage_bot) on Telegram** — it will immediately appear in your web drive!

---

## 🚀 Key Features

- 📁 **Full Virtual File System**: Infinite nested folders, customizable colors, drag-and-drop file upload, and folder moving.
- ⚡ **Real-Time Streaming & Media Players**:
  - **Video Streaming**: MP4, WebM, MKV player with seek bar and HTTP 206 range requests.
  - **Audio Player**: Integrated audio player with playlist and track info.
  - **Image Lightbox**: High-resolution viewer with Zoom In/Out, Rotate, and Fullscreen.
  - **Document & Code Viewer**: Monospace reader with line numbers, code copy, and Markdown/PDF support.
- 🔍 **Instant Search & Category Filtering**: Filter by Images, Videos, Audio, Documents, and Archives.
- 🌟 **Starring & Recycle Bin**: Star favorite files and recover deleted files with one click.
- 📊 **Storage Analytics**: Live breakdown of storage usage by category.

---

## 🛠️ How to Run

Both servers run concurrently:

```bash
npm run dev
```

- **Web UI Client**: [http://localhost:3000](http://localhost:3000)
- **Backend API Server**: [http://localhost:5000](http://localhost:5000)
- **Telegram Bot**: [@claudestorage_bot](https://t.me/claudestorage_bot)
