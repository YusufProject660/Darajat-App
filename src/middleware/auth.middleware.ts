import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { isTokenBlacklisted } from '../utils/tokenBlacklist';
import User from '../modules/users/user.model';

// Extend the Express namespace to include our custom user properties
declare global {
  namespace Express {
    interface User {
      _id: string;
      id: string;
      role: 'player' | 'admin';
      email: string;
      username: string;
      firstName: string;
      lastName?: string;
      avatar?: string;
      stats: {
        gamesPlayed: number;
        accuracy: number;
        bestScore: number;
      };
      // Add other properties that might be needed in the request
      [key: string]: any;
    }
  }
}

export interface AuthRequest extends Request {
  user?: Express.User;
}

// Main authentication middleware
export const verifyToken = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // Get token from header
    let token: string | undefined;
    
    console.log('Authorization Header:', req.headers.authorization); // Debug log
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
      console.log('Token extracted:', token ? 'Token exists' : 'No token found'); // Debug log
    } else {
      console.log('No Bearer token found in Authorization header'); // Debug log
    }

    // Check if no token
    if (!token) {
      console.log('No token provided in request'); // Debug log
      return res.status(200).json({
        status: 0,
        message: 'No token provided, authorization denied',
        debug: {
          headers: req.headers,
          authHeader: req.headers.authorization
        }
      });
    }

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return res.status(200).json({
        status: 0,
        message: 'Token has been invalidated. Please login again.'
      });
    }

    // Verify token
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { 
        id: string; 
        role: 'player' | 'admin'; 
        email: string;
        username: string;
      };
      
      if (!['player', 'admin'].includes(decoded.role)) {
        throw new Error('Invalid role in token');
      }
      
      // Fetch the full user from database
      const user = await User.findById(decoded.id).select('-password -confirmPassword').lean().exec();
      
      if (!user) {
        return res.status(200).json({
          status: 0,
          message: 'User not found. Please login again.'
        });
      }
      
      // Convert ObjectId to string and ensure all required fields are present
      const userObj = {
        ...user,
        _id: user._id.toString(),
        id: user._id.toString(),
        username: user.username || '',
        email: user.email || '',
        firstName: user.firstName || '',
        role: user.role || 'player',
        stats: user.stats || {
          gamesPlayed: 0,
          accuracy: 0,
          bestScore: 0
        }
      };
      
      // Set the user on the request
      req.user = userObj;
      next();
    } catch (err) {
      return res.status(200).json({
        status: 0,
        message: 'Token is not valid or has expired'
      });
    }
  } catch (err) {
    return res.status(200).json({
      status: 0,
      message: 'Authentication error'
    });
  }
};

// Alias for backward compatibility
export const protect = verifyToken;