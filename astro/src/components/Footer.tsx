export default function Footer() {
  const year = new Date().getFullYear();
  
  return (
    <footer className="border-t border-border bg-background mt-8">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row justify-between items-center">
          <div className="text-sm text-muted-foreground">
            © {year} Pastebin
          </div>
          <div className="text-sm text-muted-foreground mt-2 sm:mt-0">
            <ul className="flex space-x-4">
              <li>
                <a href="/" className="hover:text-foreground transition-colors">
                  Home
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-foreground transition-colors">
                  Privacy
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-foreground transition-colors">
                  Terms
                </a>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}