import { describe, it, expect } from 'vitest';
import { createContentSizeRules, validatePasteForm } from '../validation';

describe('createContentSizeRules', () => {
	const ONE_MB = 1024 * 1024;
	const [rule] = createContentSizeRules(ONE_MB);

	it('accepts ASCII content under the byte limit', () => {
		const ascii = 'a'.repeat(ONE_MB - 1);
		expect(rule.validate(ascii)).toBe(true);
	});

	it('rejects ASCII content over the byte limit', () => {
		const ascii = 'a'.repeat(ONE_MB + 1);
		expect(rule.validate(ascii)).toBe(false);
	});

	// [B19] Regression: `value.length` counts UTF-16 code units. A surrogate
	// pair (4-byte UTF-8) is 2 code units. Old check passed up to 2× the
	// byte limit for emoji-heavy / CJK-supplementary content. With
	// TextEncoder we count actual UTF-8 bytes on both sides of the wire.
	it('counts UTF-8 bytes, not UTF-16 code units (4-byte char regression)', () => {
		// 😀 is U+1F600, a surrogate pair: 2 code units, 4 UTF-8 bytes.
		// 300_000 emoji = 600_000 code units (old check: pass at 1 MB limit)
		//                = 1_200_000 bytes (new check: REJECT at 1 MB limit)
		const emoji = '\u{1F600}'.repeat(300_000);
		expect(emoji.length).toBe(600_000); // code units
		expect(new TextEncoder().encode(emoji).length).toBe(1_200_000); // bytes
		expect(rule.validate(emoji)).toBe(false);
	});

	it('accepts a single emoji within the byte limit', () => {
		expect(rule.validate('\u{1F600}')).toBe(true);
	});
});

describe('validatePasteForm', () => {
	it('reports content as required when empty', () => {
		const errors = validatePasteForm({ content: '' });
		expect(errors.content?.message).toBeTruthy();
	});

	it('accepts a normal short paste', () => {
		const errors = validatePasteForm({ content: 'hello world', title: 'note' });
		expect(errors.content).toBeUndefined();
		expect(errors.title).toBeUndefined();
	});

	it('rejects an over-limit emoji paste (B19 end-to-end)', () => {
		// 7 million emoji ≈ 28 MB UTF-8, over the 25 MB limit.
		const huge = '\u{1F600}'.repeat(7_000_000);
		const errors = validatePasteForm({ content: huge });
		expect(errors.content?.message).toMatch(/exceeds/);
	});
});
