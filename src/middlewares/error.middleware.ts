import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { logger } from '../utils/logger';

export const errorMiddleware = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  let error = err;

  if (process.env.NODE_ENV === 'development') {
    logger.error('Error:', {
      status: error.statusCode,
      message: error.message,
      stack: error.stack,
      details: error.details
    });
  }

  // Handle specific error types
  if (error.name === 'CastError') {
    error = AppError.badRequest(`Invalid ${error.path}: ${error.value}`);
  } else if (error.code === 11000) {
    const value = error.errmsg?.match(/(["'].*["'])/)?.[0] || 'a document';
    error = AppError.badRequest(`Duplicate field value: ${value}. Please use another value!`);
  } else if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map((el: any) => el.message);
    error = AppError.badRequest('Validation failed', { errors });
  } else if (error.name === 'JsonWebTokenError') {
    error = AppError.unauthorized('Invalid token. Please log in again!');
  } else if (error.name === 'TokenExpiredError') {
    error = AppError.unauthorized('Your token has expired! Please log in again.');
  }

  // If it's not an AppError, create a generic one
  if (!(error instanceof AppError)) {
    error = new AppError(error.message || 'Internal Server Error', 500);
  }

  // Always return status 200 with status: 0 for errors
  res.status(200).json({
    status: 0,
    message: error.message,
    ...(error.details && { details: error.details })
  });
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  // Skip 404 for static files - let express.static handle them
  if (req.path.endsWith('.html') || req.path.endsWith('.css') || req.path.endsWith('.js') || 
      req.path.endsWith('.png') || req.path.endsWith('.jpg') || req.path.endsWith('.ico') ||
      req.path === '/game-test.html') {
    return next();
  }
  // Only return 404 for API routes
  if (req.path.startsWith('/api/')) {
    next(AppError.notFound(`Can't find ${req.originalUrl} on this server!`));
  } else {
    // For other routes, just pass through (let static files be handled)
    next();
  }
};
