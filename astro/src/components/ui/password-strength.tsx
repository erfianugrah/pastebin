import { useState, useEffect } from 'react';
import { evaluatePasswordStrength } from '../../lib/passwordStrength';
import type { PasswordFeedback } from '../../lib/passwordStrength';

interface PasswordStrengthMeterProps {
  password: string;
  showSuggestions?: boolean;
  className?: string;
}

export function PasswordStrengthMeter({
  password,
  showSuggestions = true,
  className = '',
}: PasswordStrengthMeterProps) {
  const [feedback, setFeedback] = useState<PasswordFeedback>({
    strength: 'weak',
    score: 0,
    suggestions: [],
    color: 'var(--color-red-500, #ef4444)'
  });

  useEffect(() => {
    // Evaluate password strength when password changes
    setFeedback(evaluatePasswordStrength(password));
  }, [password]);

  // Don't show anything for empty passwords unless they've started typing
  if (!password && !feedback.score) {
    return null;
  }

  return (
    <div className={`mt-2 ${className}`}>
      {/* Strength label */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs">Password strength:</span>
        <span 
          className="text-xs font-medium capitalize"
          style={{ color: feedback.color }}
        >
          {feedback.strength}
        </span>
      </div>
      
      {/* Progress bar */}
      <div className="h-1 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-300 ease-in-out"
          style={{ 
            width: `${feedback.score}%`,
            backgroundColor: feedback.color
          }}
        ></div>
      </div>
      
      {/* Suggestions */}
      {showSuggestions && feedback.suggestions.length > 0 && (
        <ul className="mt-2 text-xs text-muted-foreground">
          {feedback.suggestions.map((suggestion, index) => (
            <li key={index} className="flex items-start mt-1">
              <span className="inline-block mr-1">•</span>
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}