export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public details?: any;
  public isOperational: boolean;

  constructor(
    message: string,
    code: string = 'INTERNAL_ERROR',
    statusCode: number = 500,
    details?: any,
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, code: string = 'BAD_REQUEST', details?: any) {
    return new ApiError(message, code, 400, details);
  }

  static unauthorized(message: string = 'Unauthorized', code: string = 'UNAUTHORIZED') {
    return new ApiError(message, code, 401);
  }

  static forbidden(message: string = 'Forbidden', code: string = 'FORBIDDEN') {
    return new ApiError(message, code, 403);
  }

  static notFound(message: string = 'Not Found', code: string = 'NOT_FOUND') {
    return new ApiError(message, code, 404);
  }

  static conflict(message: string, code: string = 'CONFLICT', details?: any) {
    return new ApiError(message, code, 409, details);
  }

  static internal(message: string = 'Internal Server Error', details?: any) {
    return new ApiError(message, 'INTERNAL_ERROR', 500, details, false);
  }
}

export default ApiError;
