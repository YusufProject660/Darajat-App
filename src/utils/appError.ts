import { Response, Request } from 'express';

export interface IErrorResponse {
  success: boolean;
  error: {
    message: string;
    code?: string;
    details?: any;
    stack?: string;
  };
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code?: string;
  public readonly details?: any;

  constructor(
    message: string, 
    statusCode: number = 500, 
    code?: string,
    isOperational: boolean = true,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.details = details;
    
    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  // Convert error to JSON response format
  public toJSON(): IErrorResponse {
    return {
      success: false,
      error: {
        message: this.message,
        ...(this.code && { code: this.code }),
        ...(this.details && { details: this.details }),
        ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
      }
    };
  }
}

// Helper functions to create common error types
export const createError = {
  badRequest: (message: string = 'Bad Request', details?: any, code: string = 'BAD_REQUEST') => 
    new AppError(message, 400, code, true, details),
  
  unauthorized: (message: string = 'Unauthorized', details?: any, code: string = 'UNAUTHORIZED') => 
    new AppError(message, 401, code, true, details),
  
  forbidden: (message: string = 'Forbidden', details?: any, code: string = 'FORBIDDEN') => 
    new AppError(message, 403, code, true, details),
  
  notFound: (message: string = 'Resource not found', details?: any, code: string = 'NOT_FOUND') => 
    new AppError(message, 404, code, true, details),
  
  conflict: (message: string = 'Conflict', details?: any, code: string = 'CONFLICT') => 
    new AppError(message, 409, code, true, details),
  
  internal: (message: string, details?: any, code: string = 'INTERNAL_SERVER_ERROR') => 
    new AppError(message, 500, code, false, details)
};

export const notFoundHandler = (req: Request, _res: Response) => {
  throw createError.notFound(`Can't find ${req.originalUrl} on this server!`);
};
