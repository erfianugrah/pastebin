import { useState, useEffect } from 'react';
import ThemeToggle from './ThemeToggle';

interface HeaderProps {
  title?: string;
}

export default function Header({ title = 'Pastebin' }: HeaderProps) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // Handle scroll events to add shadow to header when scrolled
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 10);
    };
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <header 
      className={`sticky top-0 z-40 w-full border-b border-border ${
        isScrolled ? 'bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-md' : 'bg-background'
      } transition-all`}
    >
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            <a href="/" className="hover:text-primary transition-colors">
              {title}
            </a>
          </h1>
          <p className="text-sm text-muted-foreground">
            Share code snippets, notes, and more securely
          </p>
        </div>
        
        <nav className="hidden md:flex items-center space-x-6">
          <a 
            href="/" 
            className="text-sm font-medium transition-colors hover:text-primary"
          >
            Home
          </a>
          <a 
            href="/recent" 
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Recent
          </a>
          <a 
            href="/docs/api" 
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            API
          </a>
          <a 
            href="/admin" 
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Admin
          </a>
        </nav>
        
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          
          <button
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="Toggle menu"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="24" 
              height="24" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className={isMenuOpen ? "hidden" : "block"}
            >
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="24" 
              height="24" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              className={isMenuOpen ? "block" : "hidden"}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
      
      {/* Mobile menu */}
      <div className={`md:hidden ${isMenuOpen ? "block" : "hidden"}`}>
        <nav className="px-4 py-2 pb-4 space-y-2 bg-background border-t">
          <a 
            href="/" 
            className="block py-2 px-2 rounded-lg hover:bg-muted"
            onClick={() => setIsMenuOpen(false)}
          >
            Home
          </a>
          <a 
            href="/recent" 
            className="block py-2 px-2 rounded-lg hover:bg-muted"
            onClick={() => setIsMenuOpen(false)}
          >
            Recent
          </a>
          <a 
            href="/docs/api" 
            className="block py-2 px-2 rounded-lg hover:bg-muted"
            onClick={() => setIsMenuOpen(false)}
          >
            API
          </a>
          <a 
            href="/admin" 
            className="block py-2 px-2 rounded-lg hover:bg-muted"
            onClick={() => setIsMenuOpen(false)}
          >
            Admin
          </a>
        </nav>
      </div>
    </header>
  );
}