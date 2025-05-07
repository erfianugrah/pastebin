/**
 * Validation utilities for form inputs
 */

// Validation rules types
export interface ValidationRule {
  validate: (value: string) => boolean;
  message: string;
}

export interface ValidationRules {
  [key: string]: ValidationRule[];
}

// Validation result types
export interface FieldError {
  message: string;
}

export interface ValidationErrors {
  [key: string]: FieldError;
}

/**
 * Validates a single field against its rules
 */
export function validateField(value: string, rules: ValidationRule[]): FieldError | null {
  for (const rule of rules) {
    if (!rule.validate(value)) {
      return { message: rule.message };
    }
  }
  return null;
}

/**
 * Validates a form against validation rules
 */
export function validateForm(
  formData: Record<string, string>, 
  rules: ValidationRules
): ValidationErrors {
  const errors: ValidationErrors = {};
  
  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = formData[field] || '';
    const error = validateField(value, fieldRules);
    
    if (error) {
      errors[field] = error;
    }
  }
  
  return errors;
}

/**
 * Common validation rules
 */
export const VALIDATION_RULES = {
  required: (message = 'This field is required'): ValidationRule => ({
    validate: (value) => value.trim().length > 0,
    message
  }),
  
  minLength: (length: number, message = `Must be at least ${length} characters`): ValidationRule => ({
    validate: (value) => value.length >= length,
    message
  }),
  
  maxLength: (length: number, message = `Must be no more than ${length} characters`): ValidationRule => ({
    validate: (value) => value.length <= length,
    message
  }),

  pattern: (regex: RegExp, message = 'Invalid format'): ValidationRule => ({
    validate: (value) => regex.test(value),
    message
  }),
  
  email: (message = 'Must be a valid email address'): ValidationRule => ({
    validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    message
  }),
  
  url: (message = 'Must be a valid URL'): ValidationRule => ({
    validate: (value) => {
      try {
        new URL(value);
        return true;
      } catch (e) {
        return false;
      }
    },
    message
  }),
  
  base64: (message = 'Must be a valid Base64 string'): ValidationRule => ({
    validate: (value) => /^[A-Za-z0-9+/=]*$/.test(value),
    message
  }),
  
  numeric: (message = 'Must contain only numbers'): ValidationRule => ({
    validate: (value) => /^\d+$/.test(value),
    message
  }),
  
  alphanumeric: (message = 'Must contain only letters and numbers'): ValidationRule => ({
    validate: (value) => /^[a-zA-Z0-9]+$/.test(value),
    message
  }),
  
  passwordStrength: (message = 'Password is too weak'): ValidationRule => ({
    validate: (value) => {
      // At least 8 characters with 3 of 4: uppercase, lowercase, numbers, special chars
      const hasUppercase = /[A-Z]/.test(value);
      const hasLowercase = /[a-z]/.test(value);
      const hasNumbers = /\d/.test(value);
      const hasSpecialChars = /[^a-zA-Z0-9]/.test(value);
      
      const criteriaCount = [hasUppercase, hasLowercase, hasNumbers, hasSpecialChars]
        .filter(Boolean).length;
      
      return value.length >= 8 && criteriaCount >= 3;
    },
    message
  })
};

/**
 * Create validation rules for content size
 */
export function createContentSizeRules(maxSizeBytes: number): ValidationRule[] {
  const maxSizeMB = maxSizeBytes / (1024 * 1024);
  
  return [
    {
      validate: (value) => value.length <= maxSizeBytes,
      message: `Content size exceeds the maximum allowed (${maxSizeMB.toFixed(2)} MB)`
    }
  ];
}

/**
 * Validate paste form data
 */
export function validatePasteForm(formData: Record<string, string>): ValidationErrors {
  const rules: ValidationRules = {
    content: [
      VALIDATION_RULES.required('Content is required'),
      ...createContentSizeRules(25 * 1024 * 1024) // 25MB limit
    ],
    title: [
      VALIDATION_RULES.maxLength(100, 'Title must be less than 100 characters')
    ],
    password: [
      // Only validate password if it's provided
      {
        validate: (value) => {
          if (value.trim().length === 0) return true;
          return value.length >= 8;
        },
        message: 'Password must be at least 8 characters'
      }
    ]
  };
  
  return validateForm(formData, rules);
}