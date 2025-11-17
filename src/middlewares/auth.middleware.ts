import { Request as ExpressRequest, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../config/env';
import User, { IUser } from '../modules/users/user.model';
import { logger } from '../utils/logger';

// Extend the Express Request type
declare global {
  namespace Express {
    interface User extends IUser {}
    
    interface Request {
      user?: User;
    }
  }
}

// For backward compatibility
export type AuthUser = IUser;

/**
 * Middleware to authenticate user using JWT token
 * @param req Express request object
 * @param res Express response object
 * @param next Next function
 */
export const protect = async (
  req: ExpressRequest,
  res: Response,
  next: NextFunction
) => {
  // Get token from header
  let token;
  
  if (req.headers.authorization?.startsWith('Bearer')) {
    // Get token from header
    token = req.headers.authorization.split(' ')[1];
  }
  
  // Check if token exists
  if (!token) {
    return res.status(200).json({
      status: 0,
      message: "Authorization token is missing"
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret) as { 
      id: string; 
      role?: string;
      email?: string;
      username?: string;
    };
    
    if (!decoded.id) {
      logger.warn('Token is missing user ID');
      return res.status(200).json({
        status: 0,
        message: "Invalid or expired token"
      });
    }
    
    // Get user from the token
    const user = await User.findById(new Types.ObjectId(decoded.id)).select('-password');
    
    if (!user) {
      logger.warn(`User not found with ID: ${decoded.id}`);
      return res.status(200).json({
        status: 0,
        message: "Invalid or expired token"
      });
    }

    // Attach user to request
    req.user = user as IUser;
    return next();
  } catch (error) {
    logger.error('Token verification error:', error);
    return res.status(200).json({
      status: 0,
      message: "Invalid or expired token"
    });
  }
};

/**
 * Middleware to check if user is an admin
 */
// export const admin = (req: Request, res: Response, next: NextFunction) => {
//   if (req.user && req.user.role === 'admin') {
//     next();
//   } else {
//     res.status(403);
//     throw new Error('Not authorized as an admin');
//   }
// };
