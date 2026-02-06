export default function Footer() {
  const year = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border/70 bg-background/80 mt-10">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-sm text-muted-foreground/80">
            © {year} Erfi Anugrah
          </div>
          <div className="text-sm text-muted-foreground mt-2 sm:mt-0">
            <ul className="flex space-x-2">
              <li>
                <a href="/" className="hover:text-foreground transition-colors rounded-full px-3 py-1.5 hover:bg-accent/70">
                  Home
                </a>
              </li>
              <li>
                <a 
                  href="https://github.com/erfianugrah" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors rounded-full px-3 py-1.5 hover:bg-accent/70"
                >
                  GitHub
                </a>
              </li>
              <li>
                <button 
                  onClick={() => alert('Pasteriser: A modern, secure code sharing service\n\nFeatures:\n• Enhanced syntax highlighting with line numbers\n• Code formatting and auto-indentation\n• Password protection\n• Burn after reading\n• Custom expiration times\n• Dark mode support')}
                  className="hover:text-foreground transition-colors cursor-pointer bg-transparent border-none p-0 m-0 rounded-full px-3 py-1.5 hover:bg-accent/70"
                >
                  About
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
