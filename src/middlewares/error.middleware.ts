import { Request, Response, NextFunction } from 'express';
import { AppError, IErrorResponse } from '../utils/appError';

const handleCastErrorDB = (err: any): AppError => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400, 'INVALID_INPUT');
};

const handleDuplicateFieldsDB = (err: any): AppError => {
  const value = err.errmsg?.match(/(["'].*["'])/)?.[0] || 'a document';
  const message = `Duplicate field value: ${value}. Please use another value!`;
  return new AppError(message, 400, 'DUPLICATE_FIELD');
};

const handleValidationErrorDB = (err: any): AppError => {
  const errors = Object.values(err.errors).map((el: any) => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400, 'VALIDATION_ERROR', true, errors);
};

const handleJWTError = (): AppError =>
  new AppError('Invalid token. Please log in again!', 401, 'INVALID_TOKEN');

const handleJWTExpiredError = (): AppError =>
  new AppError('Your token has expired! Please log in again.', 401, 'TOKEN_EXPIRED');

const sendError = (err: AppError, _req: Request, res: Response) => {
  // Log error in development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', {
      status: err.statusCode,
      message: err.message,
      stack: err.stack,
      ...(err.details && { details: err.details })
    });
  }

  // Send error response
  res.status(err.statusCode).json({
    success: false,
    error: {
      message: err.message,
      ...(err.code && { code: err.code }),
      ...(err.details && { details: err.details }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  } as IErrorResponse);
};

export const globalErrorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  let error = { ...err };
  error.message = err.message;
  error.stack = err.stack;

  // Handle specific error types
  if (err.name === 'CastError') error = handleCastErrorDB(err);
  if (err.code === 11000) error = handleDuplicateFieldsDB(err);
  if (err.name === 'ValidationError') error = handleValidationErrorDB(err);
  if (err.name === 'JsonWebTokenError') error = handleJWTError();
  if (err.name === 'TokenExpiredError') error = handleJWTExpiredError();

  // Default to 500 if status code not set
  error.statusCode = error.statusCode || 500;
  error.message = error.message || 'Internal Server Error';

  sendError(error, req, res);
};

// 404 Not Found handler
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      message: `Can't find ${req.originalUrl} on this server!`,
      code: 'NOT_FOUND'
    }
  });
};

export default globalErrorHandler;
