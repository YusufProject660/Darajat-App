import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';

export const errorMiddleware = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  let error = err;

  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', {
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

  // Send error response
  res.status(error.statusCode).json({
    success: false,
    message: error.message,
    statusCode: error.statusCode,
    ...(error.details && { details: error.details })
  });
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(AppError.notFound(`Can't find ${req.originalUrl} on this server!`));
};
