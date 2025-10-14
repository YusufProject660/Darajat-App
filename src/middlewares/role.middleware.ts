import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to authorize based on user roles
 * @param roles - Array of roles that are allowed to access the route
 */
export const authorize = (...roles: ('player' | 'admin')[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
    }
    
    next();
  };
};
