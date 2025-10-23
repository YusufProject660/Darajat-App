import { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';
import { ErrorResponse } from '../../../utils/errorResponse';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CATEGORIES = ['Sawm',' Salah','Prophets','Fiqh'] as const;

type Difficulty = typeof DIFFICULTIES[number];
type Category = typeof CATEGORIES[number];

interface CategoryConfig {
  enabled: boolean;
  difficulty?: Difficulty;
}

// Create validation chains
const createGameValidations: ValidationChain[] = [
  // First, check if we have a valid request body
  body()
    .custom((body, { req }) => {
      // Log the raw request body and headers for debugging
      console.log('Raw request body:', JSON.stringify(body, null, 2));
      console.log('Request headers:', req.headers);
      
      // Check if body has categories or Categories (case insensitive)
      const categories = body.categories || body.Categories;
      if (!categories) {
        throw new Error('Categories are required in the request body');
      }
      
      // Ensure categories is an object
      if (typeof categories !== 'object' || Array.isArray(categories)) {
        throw new Error('Categories must be an object');
      }
      
      // Check for at least one enabled category
      const hasEnabledCategory = Object.values(categories).some(config => {
        if (!config || typeof config !== 'object') return false;
        const enabled = config.enabled || config.Enabled;
        return enabled === true || enabled === 'true';
      });
      
      if (!hasEnabledCategory) {
        throw new Error('At least one category must be enabled');
      }
      
      // Store the sanitized categories in the request for later use
      const sanitizedCategories: Record<string, CategoryConfig> = {};
      
      for (const [category, config] of Object.entries(categories)) {
        if (config && typeof config === 'object') {
          const enabled = !!config.enabled || config.Enabled === true;
          const difficulty = (config.difficulty || config.Difficulty || 'medium')
            .toString()
            .toLowerCase() as Difficulty;
            
          if (CATEGORIES.includes(category as Category)) {
            sanitizedCategories[category] = {
              enabled,
              difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'medium'
            };
          }
        }
      }
      
      // Update the request body with the sanitized categories
      req.body.categories = sanitizedCategories;
      
      return true;
    }),
  
  body('numberOfQuestions')
    .exists().withMessage('Number of questions is required')
    .isInt({ min: 1, max: 50 }).withMessage('Number of questions must be between 1 and 50')
    .toInt(),
    
  body('maximumPlayers')
    .optional()
    .isInt({ min: 2, max: 10 }).withMessage('Maximum players must be between 2 and 10')
    .default(4)
    .toInt()
];

// Enhanced error handling middleware
const handleValidationErrors: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      
      const errorMessages = errors.array().map((error: any) => {
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
      
      const errorMessage = errorMessages.length === 1 
        ? errorMessages[0].message 
        : 'Multiple validation errors occurred';
      
      return next(new ErrorResponse(
        errorMessage,
        400,
        errorMessages.length > 1 ? errorMessages : undefined
      ));
    }
    
    next();
  } catch (error) {
    console.error('Error in validation middleware:', error);
    next(new ErrorResponse('An error occurred during validation', 500));
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