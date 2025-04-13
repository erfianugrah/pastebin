import { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';

type Theme = 'light' | 'dark' | 'system';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  // When mounted on client, get initial theme from localStorage or system preference
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    
    if (savedTheme) {
      setTheme(savedTheme);
      document.documentElement.classList.add(savedTheme);
    } else {
      setTheme('system');
      document.documentElement.classList.add(systemTheme);
    }
  }, []);

  // When theme changes, update localStorage and document class
  useEffect(() => {
    if (!mounted) return;
    
    localStorage.setItem('theme', theme);
    
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme, mounted]);

  // Handle system appearance change
  useEffect(() => {
    if (!mounted) return;
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleChange = () => {
      if (theme === 'system') {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(
          mediaQuery.matches ? 'dark' : 'light'
        );
      }
    };
    
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, mounted]);

  // We've simplified the approach with direct setTheme calls on each button
  // No need for the toggleTheme function anymore

  // This function is not currently used
  /*
  const getThemeLabel = () => {
    switch(theme) {
      case 'light': return 'Light';
      case 'dark': return 'Dark';
      default: return 'System';
    }
  };
  */

  if (!mounted) return null;

  return (
    <div className="flex items-center gap-2">
      <Button
        variant={theme === 'light' ? "default" : "outline"}
        size="sm"
        onClick={() => setTheme('light')}
        className={`px-2 ${theme === 'light' ? 'ring-2 ring-primary/50' : ''}`}
        aria-label="Light theme"
      >
        <Sun className="h-4 w-4 mr-1" />
        <span className="sr-only sm:not-sr-only sm:text-xs">Light</span>
      </Button>
      
      <Button
        variant={theme === 'dark' ? "default" : "outline"}
        size="sm"
        onClick={() => setTheme('dark')}
        className={`px-2 ${theme === 'dark' ? 'ring-2 ring-primary/50' : ''}`}
        aria-label="Dark theme"
      >
        <Moon className="h-4 w-4 mr-1" />
        <span className="sr-only sm:not-sr-only sm:text-xs">Dark</span>
      </Button>
      
      <Button
        variant={theme === 'system' ? "default" : "outline"}
        size="sm"
        onClick={() => setTheme('system')}
        className={`px-2 hidden sm:flex ${theme === 'system' ? 'ring-2 ring-primary/50' : ''}`}
        aria-label="System theme"
      >
        <span className="text-xs">System</span>
      </Button>
    </div>
  );
}