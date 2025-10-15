import { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult, ValidationChain } from 'express-validator';
import { ErrorResponse } from '../../../utils/errorResponse';

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
const CATEGORIES = ['quran', 'hadith', 'history'] as const;

type Difficulty = typeof DIFFICULTIES[number];
type Category = typeof CATEGORIES[number];

interface CategoryConfig {
  enabled: boolean;
  difficulty?: Difficulty;
}

// Create validation chains
const createGameValidations: ValidationChain[] = [
  body('categories')
    .exists().withMessage('Categories are required')
    .isObject().withMessage('Categories must be an object')
    .custom((categories: Record<string, CategoryConfig>) => {
      const enabledCategories = Object.entries(categories)
        .filter(([_, value]) => value?.enabled === true);
      
      if (enabledCategories.length === 0) {
        throw new Error('At least one category must be enabled');
      }
      
      return true;
    })
    .customSanitizer((categories: Record<string, CategoryConfig>) => {
      const result: Partial<Record<Category, CategoryConfig>> = {};
      
      for (const [category, value] of Object.entries(categories)) {
        if (CATEGORIES.includes(category as Category)) {
          result[category as Category] = {
            enabled: !!value?.enabled,
            difficulty: value?.difficulty && DIFFICULTIES.includes(value.difficulty) 
              ? value.difficulty 
              : 'medium'
          };
        }
      }
      
      return result;
    }),
  
  body('numberOfQuestions')
    .exists().withMessage('Number of questions is required')
    .isInt({ min: 1, max: 50 }).withMessage('Number of questions must be between 1 and 50')
    .toInt(),
    
  body('maximumPlayers')
    .exists().withMessage('Maximum players is required')
    .isInt({ min: 2, max: 10 }).withMessage('Maximum players must be between 2 and 10')
    .toInt()
];

// Error handling middleware
const handleValidationErrors: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map((error: any) => ({
      field: error.path || 'unknown',
      message: error.msg
    }));
    
    return next(new ErrorResponse(
      'Validation failed: ' + JSON.stringify(errorMessages), 
      400
    ));
  }
  
  next();
};

// Export as an array of middleware functions
export const validateCreateGame: (ValidationChain | RequestHandler)[] = [
  ...createGameValidations,
  handleValidationErrors
];