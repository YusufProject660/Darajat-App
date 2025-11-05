import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';

// Wraps async/await route handlers to automatically catch errors
type AsyncFunction = (req: Request, res: Response, next: NextFunction) => Promise<any>;

// Keep the original asyncHandler for backward compatibility
export const asyncHandler = (fn: AsyncFunction) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Enhanced error handler with consistent response format
export const asyncHandlerWithErrorHandling = (fn: AsyncFunction) => 
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check for validation errors from express-validator
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        const errorMessages = errors.array().map(err => err.msg);
        return res.status(200).json({
          status: 0,
          message: errorMessages[0] || 'Validation failed'
        });
      }

      // If no validation errors, proceed with the request
      await fn(req, res, next);
    } catch (error: any) {
      console.error('Request error:', error);
      
      // Handle different types of errors
      if (error.name === 'ValidationError') {
        // Mongoose validation error
        const errorMessages = Object.values(error.errors).map((err: any) => err.message);
        return res.status(200).json({
          status: 0,
          message: errorMessages[0] || 'Validation failed'
        });
      }
      
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        return res.status(200).json({
          status: 0,
          message: 'Invalid or expired token. Please log in again.'
        });
      }
      
      if (error.code === 11000) {
        // MongoDB duplicate key error
        const field = Object.keys(error.keyValue || {})[0] || 'field';
        return res.status(200).json({
          status: 0,
          message: `${field} already exists`
        });
      }
      
      // Default error response
      res.status(200).json({
        status: 0,
        message: error.message || 'An error occurred. Please try again.'
      });
    }
  };

export default asyncHandler;
