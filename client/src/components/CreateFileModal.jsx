import React, { useState } from 'react';
import {
  X,
  FileCode,
  FileText,
  Save,
  Loader2,
  Folder,
  Code2,
  FilePlus,
  Sparkles,
} from 'lucide-react';
import { api } from '../api';

const TEMPLATES = [
  {
    id: 'html',
    name: 'index.html',
    label: 'HTML Page',
    icon: '🌐',
    content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Web Page</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      text-align: center;
      padding: 1rem;
    }
    h1 { color: #f43f5e; font-size: 2.5rem; margin-bottom: 0.5rem; }
    p { color: #94a3b8; font-size: 1.1rem; max-width: 500px; line-height: 1.6; }
    .card {
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 2.5rem;
      border-radius: 1.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Welcome to My Page!</h1>
    <p>Stored seamlessly in Telegram Saved Messages & rendered via Hightech Claude Cloud.</p>
  </div>
</body>
</html>`,
  },
  {
    id: 'note',
    name: 'notes.txt',
    label: 'Text Note',
    icon: '📝',
    content: `# Quick Notes
Date: ${new Date().toLocaleDateString()}

- Important task 1
- Important task 2
- Idea / Memo: `,
  },
  {
    id: 'md',
    name: 'README.md',
    label: 'Markdown',
    icon: '📄',
    content: `# Project Title

A clean description of your project.

## Highlights
- ⚡ High Performance
- 🔒 Secure Telegram Saved Messages Storage
- 🚀 Instant Preview

## Notes
Add your markdown notes here.`,
  },
  {
    id: 'js',
    name: 'script.js',
    label: 'JavaScript',
    icon: '⚡',
    content: `// JavaScript Script
function init() {
  console.log('Script initialized from Hightech Claude Cloud');
}

init();`,
  },
  {
    id: 'json',
    name: 'data.json',
    label: 'JSON Data',
    icon: '📊',
    content: `{
  "title": "Configuration",
  "version": "1.0.0",
  "created_at": "${new Date().toISOString()}",
  "settings": {
    "theme": "dark",
    "cloud": "telegram"
  }
}`,
  },
  {
    id: 'css',
    name: 'style.css',
    label: 'CSS Styles',
    icon: '🎨',
    content: `/* Custom Stylesheet */
:root {
  --primary-color: #f43f5e;
  --bg-color: #0f172a;
}

body {
  font-family: system-ui, sans-serif;
  background-color: var(--bg-color);
  color: #f8fafc;
}`,
  },
  {
    id: 'py',
    name: 'main.py',
    label: 'Python',
    icon: '🐍',
    content: `# Python Script
def main():
    print("Hello from Hightech Claude Cloud Storage!")

if __name__ == "__main__":
    main()`,
  },
];

export default function CreateFileModal({
  isOpen,
  onClose,
  folderId,
  folderName = 'Root Directory',
  onFileCreated,
}) {
  const [fileName, setFileName] = useState('notes.txt');
  const [content, setContent] = useState(TEMPLATES[1].content);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSelectTemplate = (tpl) => {
    setFileName(tpl.name);
    setContent(tpl.content);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanName = fileName.trim();
    if (!cleanName) {
      setError('Please provide a file name.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.createNoteFile({
        name: cleanName,
        content: content || '',
        folder_id: folderId,
      });

      if (res.success) {
        if (onFileCreated) onFileCreated(res.file);
        onClose();
      } else {
        setError(res.error || 'Failed to create file.');
      }
    } catch (err) {
      setError(err.message || 'Error creating file.');
    } finally {
      setLoading(false);
    }
  };

  const lineCount = content ? content.split('\n').length : 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-3 sm:p-5 animate-fade-in select-none">
      <div className="glass-modal w-full max-w-2xl rounded-3xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-2xl bg-white dark:bg-gray-900 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/70 dark:bg-gray-900/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/25 shrink-0">
              <FilePlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <span>Create New File / Note</span>
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
                <Folder className="w-3 h-3 text-rose-500" />
                <span>Inside: <strong>{folderName || 'Root Directory'}</strong></span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs animate-fade-in shrink-0">
              {error}
            </div>
          )}

          {/* Quick Starter Templates */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-rose-500" />
              <span>Quick Starter Templates:</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => handleSelectTemplate(tpl)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer flex items-center gap-1.5 ${
                    fileName === tpl.name
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 font-bold shadow-xs'
                      : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                  }`}
                >
                  <span>{tpl.icon}</span>
                  <span>{tpl.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* File Name Input */}
          <div className="space-y-1.5 shrink-0">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              File Name & Extension
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="e.g. index.html, notes.txt, script.js"
                className="w-full px-4 py-2.5 rounded-2xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-sm font-mono text-gray-900 dark:text-gray-100 focus:border-rose-500 outline-none pr-24 shadow-inner"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold px-2 py-0.5 rounded-md bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400 uppercase font-mono">
                {fileName.split('.').pop() || 'txt'}
              </span>
            </div>
          </div>

          {/* Code / Content Editor */}
          <div className="flex-1 flex flex-col space-y-1.5 min-h-[220px]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-rose-500" />
                <span>File Content & Code:</span>
              </label>
              <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">
                {lineCount} line{lineCount !== 1 ? 's' : ''} &bull; {content.length} chars
              </span>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type your notes or paste your code here..."
              rows={12}
              className="w-full flex-1 p-4 rounded-2xl bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 text-xs sm:text-sm font-mono text-gray-800 dark:text-gray-200 focus:border-rose-500 outline-none resize-none leading-relaxed shadow-inner overflow-y-auto"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 shrink-0 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold cursor-pointer shadow-lg shadow-rose-500/20"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving to Cloud...</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Create File</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
