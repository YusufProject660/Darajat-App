import { Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';

declare global {
  namespace Express {
    interface Response {
      /**
       * Send a successful API response
       * @param data The data to be sent in the response
       * @param message Optional success message (default: 'Operation successful')
       * @returns The response object
       */
      apiSuccess: (data: any, message?: string) => Response;
      
      /**
       * Send an error API response
       * @param message Error message
       * @param errorCode Optional error code (default: 'INTERNAL_ERROR')
       * @param details Optional additional error details
       * @returns The response object
       */
      apiError: (message: string, errorCode?: string, details?: any) => Response;
    }
  }
}

/**
 * Middleware to add response formatting methods to the response object
 */
export const responseFormatter = (_req: any, res: Response, next: NextFunction) => {
  /**
   * Send a successful API response
   * @param data The data to be sent in the response
   * @param message Optional success message (default: 'Operation successful')
   */
  res.apiSuccess = function(data: any = null, message: string = 'Operation successful') {
    return this.status(200).json({
      status: 1, // 1 indicates success
      message,
      data: data || undefined // Only include data if it's not null/undefined
    });
  };

  /**
   * Send an error API response
   * @param message Error message
   * @param errorCode Optional error code (default: 'INTERNAL_ERROR')
   * @param details Optional additional error details
   */
  res.apiError = function(message: string, errorCode: string = 'INTERNAL_ERROR', details?: any) {
    // Log the error for server-side debugging
    console.error('API Error:', { message, code: errorCode, details });

    // Return error response with status 0 and message
    return this.status(200).json({
      status: 0, // 0 indicates failure
      message,
      error: {
        code: errorCode,
        details: details || undefined // Only include details if provided
      }
    });
  };

  next();
};

export default responseFormatter;
