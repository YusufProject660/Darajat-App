import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  // Log the error for server-side debugging
  console.error('Error Handler:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : {},
    ...(err instanceof ApiError && { 
      code: err.code,
      statusCode: err.statusCode,
      details: err.details 
    })
  });

  // Handle known error types
  if (err instanceof ApiError) {
    return res.apiError(err, err.code, err.details);
  }

  // Handle other types of errors
  return res.apiError(
    'Internal Server Error',
    'INTERNAL_SERVER_ERROR',
    process.env.NODE_ENV === 'development' ? { stack: err.stack } : undefined
  );
};

export default errorHandler;
