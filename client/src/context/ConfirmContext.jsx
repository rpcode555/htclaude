import React, { createContext, useContext, useState, useRef } from 'react';
import { AlertTriangle, Trash2, HelpCircle, X, Loader2 } from 'lucide-react';

const ConfirmContext = createContext();

export function ConfirmProvider({ children }) {
  const [modalState, setModalState] = useState({
    isOpen: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    variant: 'danger', // 'danger' | 'warning' | 'info'
  });

  const resolverRef = useRef(null);

  const confirm = ({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
  }) => {
    setModalState({
      isOpen: true,
      title,
      message,
      confirmText,
      cancelText,
      variant,
    });

    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  };

  const handleConfirm = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) resolverRef.current(true);
  };

  const handleCancel = () => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) resolverRef.current(false);
  };

  const getVariantStyles = () => {
    switch (modalState.variant) {
      case 'danger':
        return {
          icon: Trash2,
          iconBg: 'bg-red-500/15 border-red-500/30 text-red-400',
          btnGradient: 'bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 shadow-red-500/25',
          borderGlow: 'border-red-500/30',
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          iconBg: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
          btnGradient: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 shadow-amber-500/25',
          borderGlow: 'border-amber-500/30',
        };
      default:
        return {
          icon: HelpCircle,
          iconBg: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400',
          btnGradient: 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 shadow-cyan-500/25',
          borderGlow: 'border-cyan-500/30',
        };
    }
  };

  const styles = getVariantStyles();
  const IconComponent = styles.icon;

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}

      {/* Modern Confirmation Modal Popup */}
      {modalState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 animate-fade-in select-none">
          <div className={`w-full max-w-md rounded-3xl p-6 border shadow-2xl glass-modal text-slate-100 space-y-4 ${styles.borderGlow}`}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3.5">
                <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${styles.iconBg}`}>
                  <IconComponent className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{modalState.title}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{modalState.message}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCancel}
                className="p-1.5 rounded-xl bg-slate-850 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                {modalState.cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className={`px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-lg transition-all cursor-pointer ${styles.btnGradient}`}
              >
                {modalState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context || !context.confirm) {
    return async ({ message }) => window.confirm(message || 'Are you sure?');
  }
  return context.confirm;
}
