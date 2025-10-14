import { Request as ExpressRequest, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import User from '../modules/users/user.model';

// Define the shape of the authenticated user data
export interface AuthUser {
  _id: string;
  role: 'player' | 'admin';
}

// Extend the Express Request type
declare global {
  namespace Express {
    interface User extends AuthUser {}
    
    interface Request {
      user?: User;
    }
  }
}

// Type guard to check if the user is authenticated
declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Middleware to authenticate user using JWT token
 */
export const protect = async (
  req: ExpressRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get token from header
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];
    }
    
    // Check if token exists
    if (!token) {
      res.status(401);
      throw new Error('Not authorized, no token');
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, config.jwtSecret) as { id: string };
      
      // Get user from the token
      const user = await User.findById(decoded.id).select('-password');

      if (!user) {
        res.status(401);
        throw new Error('Not authorized, user not found');
      }

      // Set user on request object with proper typing
      const authUser: AuthUser = {
        _id: user._id.toString(),
        role: user.role
      };
      req.user = authUser;
      next();
    } catch (error) {
      console.error('Token verification error:', error);
      res.status(401);
      throw new Error('Not authorized, token failed');
    }
  } catch (error) {
    next(error);
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
