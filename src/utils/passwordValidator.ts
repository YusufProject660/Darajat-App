import { createHash } from 'crypto';

// Common passwords to block (in a real app, this should be a much larger list or use a library)
const COMMON_PASSWORDS = [
  'password', '123456', '123456789', '12345', '12345678',
  'qwerty', 'abc123', 'password1', '1234567', '123123'
];

export interface PasswordValidationResult {
  isValid: boolean;
  message: string;
  strength?: 'weak' | 'medium' | 'strong';
}

/**
 * Validates a password against security requirements
 * @param password The password to validate
 * @returns PasswordValidationResult with validation status and message
 */
export const validatePassword = (password: string): PasswordValidationResult => {
  // Check for empty password
  if (!password || password.trim().length === 0) {
    return { 
      isValid: false, 
      message: 'Password cannot be empty.',
      strength: 'weak'
    };
  }

  // Check minimum length
  if (password.length < 8) {
    return { 
      isValid: false, 
      message: 'Password must be at least 8 characters long.',
      strength: 'weak'
    };
  }

  // Check maximum length
  if (password.length > 20) {
    return { 
      isValid: false, 
      message: 'Password must not exceed 20 characters.',
      strength: 'weak'
    };
  }

  // Check for whitespace
  if (/\s/.test(password)) {
    return { 
      isValid: false, 
      message: 'Password cannot contain whitespace.',
      strength: 'weak'
    };
  }

  // Check for common password
  const lowerPassword = password.toLowerCase();
  if (COMMON_PASSWORDS.some(common => lowerPassword.includes(common.toLowerCase()))) {
    return { 
      isValid: false, 
      message: 'Password is too common. Please choose a stronger password.',
      strength: 'weak'
    };
  }

  // Check for character requirements
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]+/.test(password);

  // Calculate password strength
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  let requirementsMet = 0;
  
  if (hasUppercase) requirementsMet++;
  if (hasLowercase) requirementsMet++;
  if (hasNumber) requirementsMet++;
  if (hasSpecialChar) requirementsMet++;
  if (password.length >= 12) requirementsMet++;

  if (requirementsMet >= 4) {
    strength = 'strong';
  } else if (requirementsMet >= 2) {
    strength = 'medium';
  }

  // If password is too weak
  if (requirementsMet < 2) {
    return {
      isValid: false,
      message: 'Password is too weak. Please include a mix of uppercase, lowercase, numbers, and special characters.',
      strength
    };
  }

  // Strong password requirements
  if (strength === 'strong') {
    return {
      isValid: true,
      message: 'Password is strong!',
      strength
    };
  }

  // Medium strength password (accepted but could be stronger)
  return {
    isValid: true,
    message: 'Password accepted. For better security, consider making it stronger.',
    strength
  };
};

/**
 * Hashes a password using SHA-256
 * @param password The password to hash
 * @returns Hashed password string
 */
export const hashPassword = (password: string): string => {
  return createHash('sha256').update(password).digest('hex');
};

export default {
  validatePassword,
  hashPassword
};