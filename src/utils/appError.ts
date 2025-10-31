export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  details?: any;

  constructor(message: string, statusCode = 500, isOperational = true, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = "Bad Request", details?: any) {
    return new AppError(message, 400, true, details);
  }

  static unauthorized(message = "Unauthorized", details?: any) {
    return new AppError(message, 401, true, details);
  }

  static forbidden(message = "Forbidden", details?: any) {
    return new AppError(message, 403, true, details);
  }

  static notFound(message = "Not Found", details?: any) {
    return new AppError(message, 404, true, details);
  }

  static conflict(message = "Conflict", details?: any) {
    return new AppError(message, 409, true, details);
  }

  static internal(message = "Internal Server Error", details?: any) {
    return new AppError(message, 500, false, details);
  }
}
