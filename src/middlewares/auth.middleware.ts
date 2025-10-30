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
    return res.apiError('Not authorized, no token provided', 'UNAUTHORIZED');
  }

  try {
    // Log the received token for debugging
    console.log('Verifying token:', token);
    
    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret) as { 
      id: string; 
      role?: string;
      email?: string;
      username?: string;
    };
    
    console.log('Decoded token payload:', JSON.stringify(decoded, null, 2));
    
    if (!decoded.id) {
      console.error('Token is missing user ID');
      return res.apiError('Invalid token: Missing user ID', 'INVALID_TOKEN');
    }
    
    // Get user from the token
    const user = await User.findById(new Types.ObjectId(decoded.id)).select('-password');
    
    if (!user) {
      console.error(`User not found with ID: ${decoded.id}`);
      return res.apiError('User not found', 'USER_NOT_FOUND');
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
    if (error instanceof jwt.TokenExpiredError) {
      return res.apiError('Token has expired', 'TOKEN_EXPIRED');
    } else if (error instanceof jwt.JsonWebTokenError) {
      return res.apiError('Invalid token', 'INVALID_TOKEN');
    }
    return res.apiError('Not authorized, token verification failed', 'AUTH_FAILED');
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
