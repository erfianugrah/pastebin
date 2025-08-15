// Production-safe logging utility
const isDevelopment = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname.includes('dev'));

export const logger = {
  log: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },
  
  warn: (...args: any[]) => {
    console.warn(...args); // Warnings should always be shown
  },
  
  error: (...args: any[]) => {
    console.error(...args); // Errors should always be shown
  },
  
  // For sensitive debug info that should only show in development
  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  }
};