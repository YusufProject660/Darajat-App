import { Request, Response, NextFunction } from 'express';

/**
 * Middleware to authorize based on user roles
 * @param roles - Array of roles that are allowed to access the route
 */

export const authorize = (...roles: ('player' | 'admin')[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // This function doesn't need to return anything as it will either call next() or send a response
    console.log('=== AUTHORIZE MIDDLEWARE ===');
    console.log('Request URL:', req.originalUrl);
    console.log('Request Method:', req.method);
    console.log('Request Headers:', req.headers);
    console.log('Request User:', req.user);
    console.log('Allowed roles:', roles);
    
    if (!req.user) {
      console.log('No user found in request');
      res.status(401).json({
        success: false,
        error: 'Not authorized to access this route'
      });
      return;
    }

    console.log('User role from request:', req.user.role);
    
    if (!roles.includes(req.user.role)) {
      console.log(`User role '${req.user.role}' is not in allowed roles:`, roles);
      res.status(403).json({
        success: false,
        error: `User role ${req.user.role} is not authorized to access this route`
      });
      return;
    }
    
    console.log('User authorized with role:', req.user.role);
    next();
  };
};
