import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Middleware to authorize based on user roles
 * @param roles - Array of roles that are allowed to access the route
 */

export const authorize = (...roles: ('player' | 'admin')[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // This function doesn't need to return anything as it will either call next() or send a response
    logger.debug('=== AUTHORIZE MIDDLEWARE ===', {
      url: req.originalUrl,
      method: req.method,
      user: req.user?.id,
      allowedRoles: roles
    });
    
    if (!req.user) {
      logger.warn('No user found in request');
      res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
      return;
    }

    logger.debug('User role from request:', req.user.role);
    
    if (!roles.includes(req.user.role)) {
      logger.warn(`User role '${req.user.role}' is not in allowed roles:`, roles);
      res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
      return;
    }
    
    logger.debug('User authorized with role:', req.user.role);
    next();
  };
};
