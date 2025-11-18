import { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CATEGORIES = ['quran', 'hadith', 'history', 'fiqh', 'seerah'] as const;

type Difficulty = typeof DIFFICULTIES[number];
type Category = typeof CATEGORIES[number];

interface CategoryConfig {
  enabled: boolean;
  difficulty: Difficulty;
  name: string;
}

// Create validation chains
const createGameValidations: ValidationChain[] = [
  // First, check if we have a valid request body
  body()
    .custom((body, { req }) => {
      // Log the raw request body and headers for debugging
      console.log('Raw request body:', JSON.stringify(body, null, 2));
      console.log('Request headers:', req.headers);
      
      // Check if body has categories (case insensitive)
      const categories = body.categories || body.Categories;
      if (!categories) {
        throw new Error('Categories are required in the request body');
      }
      
      // Log the raw categories for debugging
      console.log('Raw categories from request:', JSON.stringify(categories, null, 2));
      
      // Ensure categories is an object
      if (typeof categories !== 'object' || Array.isArray(categories)) {
        throw new Error('Categories must be an object');
      }
      
      // Define a type for the raw category config from the request
      type RawCategoryConfig = {
        enabled?: boolean | string;
        Enabled?: boolean | string;
        difficulty?: string;
        Difficulty?: string;
      };

      // Check for at least one enabled category
      const hasEnabledCategory = Object.entries(categories as Record<string, RawCategoryConfig>).some(([category, config]) => {
        if (!config || typeof config !== 'object') return false;
        const enabled = config.enabled ?? config.Enabled;
        const categoryLower = category.toLowerCase();
        return (enabled === true || enabled === 'true') && CATEGORIES.includes(categoryLower as Category);
      });
      
      if (!hasEnabledCategory) {
        throw new Error('At least one category must be enabled');
      }
      
      // Store the sanitized categories in the request for later use
      // Include ALL categories (both enabled and disabled) so controller can process them
      const sanitizedCategories: Record<string, { enabled: boolean; difficulty: string }> = {};
      
      for (const [category, config] of Object.entries(categories as Record<string, RawCategoryConfig>)) {
        if (config && typeof config === 'object') {
          const enabled = !!config.enabled || config.Enabled === true || config.Enabled === 'true';
          const difficulty = (config.difficulty || config.Difficulty || 'easy').toString().toLowerCase();
          
          const categoryLower = category.toLowerCase();
          if (CATEGORIES.includes(categoryLower as Category)) {
            // Validate difficulty only if category is enabled
            if (enabled && !DIFFICULTIES.includes(difficulty as Difficulty)) {
              throw new Error(`Invalid difficulty '${difficulty}' for category '${category}'. Must be one of: ${DIFFICULTIES.join(', ')}`);
            }
            
            // Add all categories (enabled and disabled) to sanitizedCategories
            sanitizedCategories[categoryLower] = {
              enabled,
              difficulty: (enabled ? difficulty : 'easy') as Difficulty
            };
          }
        }
      }
      
      // Update the request body with the sanitized categories (all categories, not just enabled)
      req.body.categories = sanitizedCategories;
      
      return true;
    }),
  
  // Add a pre-validation step to normalize field names
  body()
    .custom((body, { req }) => {
      console.log('Raw request body in validation:', JSON.stringify(body, null, 2));
      
      // Normalize field names to camelCase
      if (body.number_of_questions !== undefined) {
        body.numberOfQuestions = body.number_of_questions;
      }
      if (body.maximum_players !== undefined) {
        body.maximumPlayers = body.maximum_players;
      }
      
      // Ensure we have the required fields after normalization
      if (body.numberOfQuestions === undefined) {
        console.log('Number of questions is missing. Available fields:', Object.keys(body));
        throw new Error('Number of questions is required');
      }
      
      // Convert to numbers and validate
      const numQuestions = parseInt(body.numberOfQuestions, 10);
      if (isNaN(numQuestions) || numQuestions < 1 || numQuestions > 60) {
        throw new Error('Number of questions must be between 1 and 60');
      }
      
      // Set default for maximumPlayers if not provided
      if (body.maximumPlayers === undefined) {
        body.maximumPlayers = 4;
      }
      
      const maxPlayers = parseInt(body.maximumPlayers, 10);
      if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 10) {
        throw new Error('Maximum players must be between 2 and 10');
      }
      
      // Update the request body with normalized values
      req.body.numberOfQuestions = numQuestions;
      req.body.maximumPlayers = maxPlayers;
      
      return true;
    })
];

// Enhanced error handling middleware
const handleValidationErrors: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      const allErrors = errors.array();
      const errorMessages = allErrors.map((error: any) => {
        // Handle different types of validation errors
        if (error.msg === 'Invalid value') {
          return {
            field: error.param || 'unknown',
            message: `Invalid value provided for ${error.param}`,
            value: error.value
          };
        }
        
        return {
          field: error.param || 'unknown',
          message: error.msg,
          ...(error.value && { value: error.value })
        };
      });
      
      // Prefer specific category error if present
      const categoryError = errorMessages.find(e => (e.message || '').includes('At least one category must be enabled'));
      const errorMessage = categoryError ? categoryError.message : (errorMessages[0]?.message || 'Invalid request');
      
      res.apiError(errorMessage, 'VALIDATION_ERROR');
      return;
    }
    
    next();
    return;
  } catch (error) {
    console.error('Error in validation middleware:', error);
    res.apiError('An error occurred during validation', 'VALIDATION_ERROR');
    return;
  }
};

// Join game validations
const joinGameValidations: ValidationChain[] = [
  body('roomCode')
    .exists().withMessage('Room code is required')
    .isString().withMessage('Room code must be a string')
    .trim()
    .isLength({ min: 4, max: 10 }).withMessage('Room code must be between 4 and 10 characters')
    .toUpperCase()
];

// Export as an array of middleware functions
export const validateCreateGame: (ValidationChain | RequestHandler)[] = [
  ...createGameValidations,
  handleValidationErrors
];

export const validateJoinGame: (ValidationChain | RequestHandler)[] = [
  ...joinGameValidations,
  handleValidationErrors
];