// Utility helpers for formatting and file icons

export function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatDate(isoString) {
  if (!isoString) return '—';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function getFileCategoryColor(category) {
  switch (category?.toLowerCase()) {
    case 'images':
      return {
        badge: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
        glow: 'hover:border-pink-500/40 hover:shadow-pink-500/10',
        iconBg: 'bg-pink-500/15 text-pink-400',
      };
    case 'videos':
      return {
        badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
        glow: 'hover:border-purple-500/40 hover:shadow-purple-500/10',
        iconBg: 'bg-purple-500/15 text-purple-400',
      };
    case 'audio':
      return {
        badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        glow: 'hover:border-emerald-500/40 hover:shadow-emerald-500/10',
        iconBg: 'bg-emerald-500/15 text-emerald-400',
      };
    case 'documents':
      return {
        badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        glow: 'hover:border-blue-500/40 hover:shadow-blue-500/10',
        iconBg: 'bg-blue-500/15 text-blue-400',
      };
    case 'archives':
      return {
        badge: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        glow: 'hover:border-amber-500/40 hover:shadow-amber-500/10',
        iconBg: 'bg-amber-500/15 text-amber-400',
      };
    default:
      return {
        badge: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
        glow: 'hover:border-slate-500/40 hover:shadow-slate-500/10',
        iconBg: 'bg-slate-500/15 text-slate-400',
      };
  }
}
