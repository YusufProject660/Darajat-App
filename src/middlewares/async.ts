import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { logger } from '../utils/logger';

// Wraps async/await route handlers to automatically catch errors
type AsyncFunction = (req: any, res: Response, next: NextFunction) => Promise<any>;

// Keep the original asyncHandler for backward compatibility
export const asyncHandler = (fn: AsyncFunction) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Enhanced error handler with consistent response format
export const asyncHandlerWithErrorHandling = (fn: AsyncFunction) => 
  async (req: Request, res: Response, next: NextFunction): Promise<void | Response> => {
    try {
      // Check for validation errors from express-validator
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg);
        res.status(200).json({
          status: 0,
          message: errorMessages[0] || 'Validation failed'
        });
        return;
      }

      // If no validation errors, proceed with the request
      await fn(req, res, next);
    } catch (error: any) {
      logger.error('Request error:', error);
      
      // Handle different types of errors
      if (error.name === 'ValidationError') {
        // Mongoose validation error
        const errorMessages = Object.values(error.errors).map((err: any) => err.message);
        res.status(200).json({
          status: 0,
          message: errorMessages[0] || 'Validation failed'
        });
        return;
      }
      
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        res.status(200).json({
          status: 0,
          message: 'Invalid or expired token. Please log in again.'
        });
        return;
      }
      
      if (error.code === 11000) {
        // MongoDB duplicate key error
        const field = Object.keys(error.keyValue || {})[0] || 'field';
        res.status(200).json({
          status: 0,
          message: `${field} already exists`
        });
        return;
      }
      
      // Default error response
      res.status(200).json({
        status: 0,
        message: error.message || 'An error occurred. Please try again.'
      });
    }
  };

export default asyncHandler;

