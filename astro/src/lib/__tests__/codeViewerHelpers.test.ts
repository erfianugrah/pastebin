import { describe, it, expect } from 'vitest';
import { detectImage, formatBytes } from '../codeViewerHelpers';

describe('formatBytes', () => {
	it('formats sub-KB sizes without decimals', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1)).toBe('1 B');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('flips to KB at 1024', () => {
		expect(formatBytes(1024)).toBe('1.0 KB');
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(1024 * 1023)).toBe('1023.0 KB');
	});

	it('flips to MB at 1024 KB', () => {
		expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
		expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
	});

	it('keeps MB unit even for very large payloads (no GB yet)', () => {
		// 100 MB
		expect(formatBytes(100 * 1024 * 1024)).toBe('100.0 MB');
	});
});

describe('detectImage', () => {
	describe('returns null', () => {
		it('for empty / whitespace-only input', () => {
			expect(detectImage('')).toBeNull();
			expect(detectImage('   ')).toBeNull();
			expect(detectImage('\n\n\t')).toBeNull();
		});

		it('for plain text', () => {
			expect(detectImage('hello world')).toBeNull();
			expect(detectImage('console.log("hi")')).toBeNull();
		});

		it('for content >5MB (refuse to scan)', () => {
			const huge = 'a'.repeat(5_000_001);
			expect(detectImage(huge)).toBeNull();
		});

		it('for non-image data URIs', () => {
			expect(detectImage('data:text/plain;base64,aGVsbG8=')).toBeNull();
			expect(detectImage('data:application/json;base64,e30=')).toBeNull();
		});

		it('for non-http(s) URLs', () => {
			expect(detectImage('ftp://example.com/foo.png')).toBeNull();
			expect(detectImage('file:///tmp/foo.png')).toBeNull();
			expect(detectImage('javascript:alert(1)')).toBeNull();
		});

		it('for URLs without an image extension', () => {
			expect(detectImage('https://example.com/foo')).toBeNull();
			expect(detectImage('https://example.com/foo.html')).toBeNull();
			expect(detectImage('https://example.com/foo.pdf')).toBeNull();
		});

		it('for markdown with surrounding content', () => {
			expect(detectImage('text\n![](https://e.io/a.png)')).toBeNull();
			expect(detectImage('![](https://e.io/a.png) more text')).toBeNull();
			expect(detectImage('![](https://e.io/a.png)\n![](https://e.io/b.png)')).toBeNull();
		});

		it('for markdown image with non-http(s) target', () => {
			expect(detectImage('![alt](javascript:alert(1))')).toBeNull();
			expect(detectImage('![alt](file:///foo.png)')).toBeNull();
		});
	});

	describe('branch 1 — data URIs', () => {
		it('accepts all supported image types', () => {
			const cases = [
				'data:image/png;base64,iVBORw0KGgo=',
				'data:image/jpeg;base64,/9j/4AAQ=',
				'data:image/jpg;base64,/9j/4AAQ=',
				'data:image/gif;base64,R0lGODlh=',
				'data:image/webp;base64,UklGRiQ=',
				'data:image/svg+xml;base64,PHN2Zz4=',
				'data:image/avif;base64,AAAAGGZ0=',
				'data:image/bmp;base64,Qk0e=',
				'data:image/x-icon;base64,AAABA=',
			];
			for (const c of cases) {
				expect(detectImage(c), c).toBe(c);
			}
		});

		it('is case-insensitive on the mime type', () => {
			const upper = 'data:IMAGE/PNG;base64,iVBORw0KGgo=';
			expect(detectImage(upper)).toBe(upper);
		});

		it('trims surrounding whitespace before matching', () => {
			const trimmed = 'data:image/png;base64,iVBORw0KGgo=';
			expect(detectImage(`  ${trimmed}  `)).toBe(trimmed);
		});
	});

	describe('branch 2 — direct URL', () => {
		it('accepts http and https', () => {
			expect(detectImage('http://example.com/cat.png')).toBe('http://example.com/cat.png');
			expect(detectImage('https://example.com/cat.png')).toBe('https://example.com/cat.png');
		});

		it('accepts all supported extensions', () => {
			const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'];
			for (const e of exts) {
				const url = `https://example.com/cat.${e}`;
				expect(detectImage(url), e).toBe(url);
			}
		});

		it('accepts trailing query string', () => {
			const url = 'https://example.com/cat.png?v=1&size=large';
			expect(detectImage(url)).toBe(url);
		});

		it('is case-insensitive on the extension', () => {
			expect(detectImage('https://example.com/CAT.PNG')).toBe('https://example.com/CAT.PNG');
		});
	});

	describe('branch 3 — markdown image', () => {
		it('extracts the URL from ![alt](url)', () => {
			expect(detectImage('![cat](https://e.io/cat.png)')).toBe('https://e.io/cat.png');
		});

		it('accepts empty alt text', () => {
			expect(detectImage('![](https://e.io/cat.png)')).toBe('https://e.io/cat.png');
		});

		it('accepts a data: URI target', () => {
			const md = '![icon](data:image/png;base64,iVBORw0KGgo=)';
			expect(detectImage(md)).toBe('data:image/png;base64,iVBORw0KGgo=');
		});

		it('accepts a URL without a recognised image extension (alt-text contract)', () => {
			// The markdown branch is permissive: if the user wrote `![]()` they
			// asserted "this is an image", so we honour it even for opaque URLs
			// (CDN endpoints, S3-signed URLs, etc.).
			expect(detectImage('![](https://cdn.example.com/asset/abc123)')).toBe(
				'https://cdn.example.com/asset/abc123',
			);
		});

		it('trims surrounding whitespace before matching', () => {
			expect(detectImage('  ![](https://e.io/cat.png)  ')).toBe('https://e.io/cat.png');
		});
	});
});
