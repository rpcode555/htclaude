import React, { createContext, useContext, useEffect } from 'react';

const ThemeContext = createContext();

// Light mode is the ONLY theme — no toggle, no dark mode.
// ThemeContext is kept for API compatibility but is a no-op.
export function ThemeProvider({ children }) {
  useEffect(() => {
    // Always ensure light mode — remove any legacy dark class
    document.documentElement.classList.remove('dark', 'light-theme');
    document.body.classList.remove('dark', 'light-theme');
    localStorage.removeItem('htc_theme');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'light', isDark: false, toggleTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
