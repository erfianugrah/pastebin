/**
 * Password strength evaluation utilities
 */

export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'very-strong';

export interface PasswordFeedback {
  strength: PasswordStrength;
  score: number; // 0-100
  suggestions: string[];
  color: string; // CSS color for visual feedback
}

/**
 * Calculate password strength based on various criteria
 * @param password The password to evaluate
 * @returns Object with strength rating, score, and improvement suggestions
 */
export function evaluatePasswordStrength(password: string): PasswordFeedback {
  // Default feedback for empty passwords
  if (!password) {
    return {
      strength: 'weak',
      score: 0,
      suggestions: ['Enter a password'],
      color: 'var(--color-red-500, #ef4444)'
    };
  }

  let score = 0;
  const suggestions: string[] = [];

  // Base score on length (up to 40 points)
  const lengthScore = Math.min(password.length * 4, 40);
  score += lengthScore;

  // Check for character variety (up to 60 additional points)
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasDigits = /\d/.test(password);
  const hasSpecialChars = /[^a-zA-Z0-9]/.test(password);

  // Add points for character variety
  if (hasLowercase) score += 10;
  if (hasUppercase) score += 15;
  if (hasDigits) score += 15;
  if (hasSpecialChars) score += 20;

  // Add suggestions based on missing elements
  if (!hasLowercase) suggestions.push('Add lowercase letters');
  if (!hasUppercase) suggestions.push('Add uppercase letters');
  if (!hasDigits) suggestions.push('Add numbers');
  if (!hasSpecialChars) suggestions.push('Add special characters');
  if (password.length < 10) suggestions.push('Make it longer (10+ chars ideal)');

  // Check for common patterns
  if (/^[a-zA-Z]+$/.test(password)) {
    suggestions.push('Mix letters with numbers and symbols');
  }
  if (/^[0-9]+$/.test(password)) {
    suggestions.push('Don\'t use only numbers');
    score -= 10;
  }
  if (/(.)\1{2,}/.test(password)) {
    suggestions.push('Avoid repeating characters');
    score -= 10;
  }

  // Check for sequential characters
  if (/(?:abcdefghijklmnopqrstuvwxyz|01234567890)/i.test(password)) {
    suggestions.push('Avoid sequential characters');
    score -= 10;
  }

  // Ensure score is within 0-100 range
  score = Math.max(0, Math.min(100, score));

  // Determine strength label based on score
  let strength: PasswordStrength = 'weak';
  let color = 'var(--color-red-500, #ef4444)';

  if (score >= 80) {
    strength = 'very-strong';
    color = 'var(--color-green-600, #16a34a)';
  } else if (score >= 60) {
    strength = 'strong';
    color = 'var(--color-green-500, #22c55e)';
  } else if (score >= 40) {
    strength = 'medium';
    color = 'var(--color-yellow-500, #eab308)';
  }

  // Limit to 3 suggestions maximum
  const limitedSuggestions = suggestions.slice(0, 3);

  return {
    strength,
    score,
    suggestions: limitedSuggestions,
    color
  };
}