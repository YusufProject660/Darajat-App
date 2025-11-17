// src/utils/appError.ts
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  details: any;

  constructor(
    message: string, 
    statusCode: number = 500, 
    isOperational: boolean = true, 
    details: any = {}
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    // Remove code from details
    const { code, ...rest } = details;
    this.details = Object.keys(rest).length > 0 ? rest : undefined;
  }

  static badRequest(message: string, details?: any) {
    return new AppError(message, 400, true, details);
  }

  static unauthorized(message: string = 'Unauthorized', details?: any) {
    return new AppError(message, 401, true, details);
  }

  static notFound(message: string = 'Not Found', details?: any) {
    return new AppError(message, 404, true, details);
  }

  static forbidden(message: string = 'Forbidden', details?: any) {
    return new AppError(message, 403, true, details);
  }

  static conflict(message: string = 'Conflict', details?: any) {
    return new AppError(message, 409, true, details);
  }

  static internal(message: string = 'Internal Server Error', details?: any) {
    return new AppError(message, 500, false, details);
  }
}