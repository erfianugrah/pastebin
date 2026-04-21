import { useState, useRef, useEffect, useMemo } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';

// ── Language data ────────────────────────────────────────────────────

interface LanguageOption {
	value: string;
	label: string;
}

interface LanguageGroup {
	label: string;
	items: LanguageOption[];
}

const LANGUAGE_GROUPS: LanguageGroup[] = [
	{
		label: 'Web',
		items: [
			{ value: 'markup', label: 'HTML' },
			{ value: 'css', label: 'CSS' },
			{ value: 'javascript', label: 'JavaScript' },
			{ value: 'typescript', label: 'TypeScript' },
			{ value: 'jsx', label: 'JSX' },
			{ value: 'tsx', label: 'TSX' },
			{ value: 'php', label: 'PHP' },
		],
	},
	{
		label: 'Data',
		items: [
			{ value: 'json', label: 'JSON' },
			{ value: 'yaml', label: 'YAML' },
			{ value: 'toml', label: 'TOML' },
			{ value: 'xml-doc', label: 'XML' },
			{ value: 'ini', label: 'INI' },
			{ value: 'sql', label: 'SQL' },
			{ value: 'graphql', label: 'GraphQL' },
		],
	},
	{
		label: 'Systems',
		items: [
			{ value: 'python', label: 'Python' },
			{ value: 'go', label: 'Go' },
			{ value: 'rust', label: 'Rust' },
			{ value: 'java', label: 'Java' },
			{ value: 'csharp', label: 'C#' },
			{ value: 'c', label: 'C' },
			{ value: 'cpp', label: 'C++' },
			{ value: 'ruby', label: 'Ruby' },
			{ value: 'kotlin', label: 'Kotlin' },
			{ value: 'swift', label: 'Swift' },
			{ value: 'scala', label: 'Scala' },
			{ value: 'perl', label: 'Perl' },
			{ value: 'r', label: 'R' },
		],
	},
	{
		label: 'DevOps',
		items: [
			{ value: 'bash', label: 'Bash' },
			{ value: 'shell-session', label: 'Shell' },
			{ value: 'powershell', label: 'PowerShell' },
			{ value: 'docker', label: 'Dockerfile' },
			{ value: 'hcl', label: 'HCL (Terraform)' },
			{ value: 'nginx', label: 'Nginx' },
		],
	},
	{
		label: 'Markup & Style',
		items: [
			{ value: 'markdown', label: 'Markdown' },
			{ value: 'latex', label: 'LaTeX' },
			{ value: 'scss', label: 'SCSS' },
			{ value: 'less', label: 'LESS' },
		],
	},
];

const ALL_LANGUAGES: LanguageOption[] = [
	{ value: 'plaintext', label: 'Plain Text' },
	...LANGUAGE_GROUPS.flatMap((g) => g.items),
];

function getLanguageLabel(value: string): string {
	return ALL_LANGUAGES.find((l) => l.value === value)?.label ?? 'Plain Text';
}

// ── Combobox ─────────────────────────────────────────────────────────

interface LanguageComboboxProps {
	value: string;
	onChange: (value: string) => void;
}

export function LanguageCombobox({ value, onChange }: LanguageComboboxProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState('');
	const [highlightIndex, setHighlightIndex] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Close on click outside
	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
				setSearch('');
			}
		};
		document.addEventListener('mousedown', handler);
		return () => document.removeEventListener('mousedown', handler);
	}, [open]);

	// Filter groups
	const query = search.toLowerCase().trim();
	const filtered = useMemo(() => {
		if (!query) return LANGUAGE_GROUPS;
		return LANGUAGE_GROUPS.map((g) => ({
			...g,
			items: g.items.filter(
				(l) => l.label.toLowerCase().includes(query) || l.value.toLowerCase().includes(query),
			),
		})).filter((g) => g.items.length > 0);
	}, [query]);

	// Flat list for keyboard nav
	const showPlainText = !query || 'plain text'.includes(query) || 'plaintext'.includes(query);
	const flatList = useMemo(() => {
		return [
			...(showPlainText ? [{ value: 'plaintext', label: 'Plain Text' }] : []),
			...filtered.flatMap((g) => g.items),
		];
	}, [filtered, showPlainText]);

	// Reset highlight when search changes
	useEffect(() => {
		setHighlightIndex(0);
	}, [search]);

	// Focus input when opening
	useEffect(() => {
		if (open) requestAnimationFrame(() => inputRef.current?.focus());
	}, [open]);

	// Scroll highlighted item into view
	useEffect(() => {
		if (!listRef.current || highlightIndex < 0) return;
		const items = listRef.current.querySelectorAll('[data-item]');
		items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
	}, [highlightIndex]);

	function select(v: string) {
		onChange(v);
		setOpen(false);
		setSearch('');
		setHighlightIndex(0);
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				setHighlightIndex((i) => Math.min(i + 1, flatList.length - 1));
				break;
			case 'ArrowUp':
				e.preventDefault();
				setHighlightIndex((i) => Math.max(i - 1, 0));
				break;
			case 'Enter':
				e.preventDefault();
				if (flatList[highlightIndex]) select(flatList[highlightIndex].value);
				break;
			case 'Escape':
				e.preventDefault();
				setOpen(false);
				setSearch('');
				break;
		}
	}

	return (
		<div ref={containerRef} className="relative">
			{/* Trigger */}
			<button
				type="button"
				role="combobox"
				aria-expanded={open}
				aria-haspopup="listbox"
				onClick={() => setOpen(!open)}
				className={cn(
					'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-inner ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring',
					!value && 'text-muted-foreground',
				)}
			>
				<span className="truncate">{getLanguageLabel(value)}</span>
				<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</button>

			{/* Dropdown */}
			{open && (
				<div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95">
					{/* Search input */}
					<div className="flex items-center border-b px-3 py-2">
						<Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
						<input
							ref={inputRef}
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Search languages..."
							className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						/>
					</div>

					{/* Items */}
					<div ref={listRef} role="listbox" className="max-h-60 overflow-y-auto p-1">
						{flatList.length === 0 ? (
							<div className="py-6 text-center text-sm text-muted-foreground">No language found.</div>
						) : (
							<>
								{showPlainText && (
									<ComboboxItem
										label="Plain Text"
										selected={value === 'plaintext'}
										highlighted={highlightIndex === 0}
										onSelect={() => select('plaintext')}
									/>
								)}
								{filtered.map((group) => (
									<div key={group.label}>
										<div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
											{group.label}
										</div>
										{group.items.map((item) => {
											const idx = flatList.findIndex((f) => f.value === item.value);
											return (
												<ComboboxItem
													key={item.value}
													label={item.label}
													selected={value === item.value}
													highlighted={highlightIndex === idx}
													onSelect={() => select(item.value)}
												/>
											);
										})}
									</div>
								))}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Item ─────────────────────────────────────────────────────────────

function ComboboxItem({
	label,
	selected,
	highlighted,
	onSelect,
}: {
	label: string;
	selected: boolean;
	highlighted: boolean;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			data-item
			onClick={onSelect}
			className={cn(
				'relative flex w-full items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none transition-colors',
				highlighted ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
			)}
		>
			{label}
			{selected && <Check className="absolute right-2 h-4 w-4" />}
		</button>
	);
}
