import { Request as ExpressRequest, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { config } from '../config/env';
import User, { IUser } from '../modules/users/user.model';

// Extend the Express Request type
declare global {
  namespace Express {
    interface User extends IUser {}
    
    interface Request {
      user?: User;
    }
  }
}

// Type guard to check if the user is authenticated
declare module 'express-serve-static-core' {
  interface Request {
    user?: IUser;
  }
}

// For backward compatibility
export type AuthUser = IUser;

/**
 * Middleware to authenticate user using JWT token
 */
/**
 * Middleware to authenticate user using JWT token
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
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret) as { id: string };
    
    // Get user from the token
    const user = await User.findById(new Types.ObjectId(decoded.id)).select('-password');

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Convert to plain object and explicitly type it as IUser
    const userObj = user.toObject();
    // Make sure the required fields are properly set on the user object
    req.user = {
      _id: userObj._id,
      id: userObj._id.toString(),
      username: userObj.username, // Ensure username is included
      email: userObj.email,
      avatar: userObj.avatar,     // Include avatar as it's used in game
      role: userObj.role || 'player',
      password: userObj.password,
      confirmPassword: userObj.confirmPassword,
      stats: userObj.stats || {
        gamesPlayed: 0,
        accuracy: 0,
        bestScore: 0
      }
    } as IUser;
    return next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({ message: 'Not authorized, token failed' });
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
