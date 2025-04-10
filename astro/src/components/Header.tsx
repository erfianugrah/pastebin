import ThemeToggle from './ThemeToggle';

interface HeaderProps {
  title?: string;
}

export default function Header({ title = 'Pastebin' }: HeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="container mx-auto px-4 py-4 flex justify-between items-center">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">
            <a href="/" className="hover:text-primary transition-colors">
              {title}
            </a>
          </h1>
          <p className="text-sm text-muted-foreground">
            Share code snippets, notes, and more
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}