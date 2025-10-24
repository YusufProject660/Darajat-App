import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { IUser } from './user.model'; // Make sure this path is correct
import { register, login, getMe, forgotPassword, resetPassword } from './auth.service';
import { AppError } from '../../middlewares/error.middleware';
import asyncHandler from '../../middleware/async';

// Helper function to generate JWT token
const generateToken = (user: IUser): string => {
  return jwt.sign(
    { 
      id: user._id,
      role: user.role 
    },
    config.jwtSecret, 
    { expiresIn: '7d' }
  );
};

// Extend the Express Request type to include our user property
declare global {
  namespace Express {
    interface User {
      _id: string;
      id: string;
      role: 'player' | 'admin';
      email: string;
      password: string;
      confirmPassword: string;
      [key: string]: any;
    }
    
    interface Request {
      user?: User;
    }
  }
}

type AuthRequest = Request;

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const registerUser = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { email, password, confirmPassword } = req.body;

  // Validate required fields
  if (!email || !password || !confirmPassword) {
    return next(new AppError('Email, password, and confirmPassword are required.', 400));
  }

  // Check if passwords match
  if (password !== confirmPassword) {
    return next(new AppError('Password and confirm password do not match.', 400));
  }

  try {
    // Use email as username for now
    const user = await register(email, email, password);
    
    return res.status(201).json({
      success: true,
      message: 'Sign up successful',
      token: user.token
    });
  } catch (error: any) {
    if (error.message === 'User already exists') {
      return next(new AppError('Email already registered.', 400));
      return res.status(400).json({
        success: false,
        error: 'Email already registered.'
      });
    }
    next(error);
  }
});

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;

  // Check for missing fields
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Email and password are required'
    });
  }

  try {
    const user = await login(email, password);
    
    // Create secure cookie with token
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict' as const,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    };

    res.cookie('token', user.token, cookieOptions);

    // Return success response with token
    res.status(201).json({
      success: true,
      message: 'Login successful',
      token: user.token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        stats: user.stats
      }
    });
  } catch (error: any) {
    // Handle specific error cases
    if (error.message === 'No account found with this email') {
      return res.status(401).json({
        success: false,
        message: 'No account found with this email'
      });
    }
    
    if (error.message === 'Invalid password') {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }
    
    // For any other errors, pass to the error handler
    next(error);
  }
});

// @desc    Get current logged in user data
// @route   GET /api/auth/me
// @access  Private
export const getMeHandler = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Not authorized to access this route', 401));
  }

  try {
    const user = await getMe(req.user._id);
    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// @desc    Logout user / clear cookie
// @route   GET /api/auth/logout
// @access  Private
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000), // 10 seconds
    httpOnly: true,
  });

  res.status(200).json({
    success: true,
    data: {}
  });
});

// @desc    Check if user is admin
// @route   GET /api/auth/admin
// @access  Private/Admin
export const isAdmin = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user || req.user.role !== 'admin') {
    return next(new AppError('Not authorized to access this route', 403));
  }
  
  res.status(200).json({
    success: true,
    data: { role: 'admin' }
  });
});

// @desc    Google OAuth callback
// @route   GET /api/auth/google/callback
// @access  Public
export const googleCallback = async (req: Request, res: Response) => {
  try {
    // The user should be attached to req.user by Passport
    if (!req.user) {
      return res.redirect('/api/auth/google/failure');
    }
    
    // Generate token
    const token = generateToken(req.user as unknown as IUser);
    
    // Redirect to success with token
    return res.redirect(`/api/auth/google/success?token=${token}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    return res.redirect('/api/auth/google/failure');
  }
};

// @desc    Google OAuth success
// @route   GET /api/auth/google/success
// @access  Public
export const googleAuthSuccess = (req: Request, res: Response) => {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'No token provided'
      });
    }
    
    return res.status(200).json({
      success: true,
      token,
      message: 'Google authentication successful'
    });
  } catch (error) {
    console.error('Google OAuth success error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
};

// @desc    Google OAuth failure
// @route   GET /api/auth/google/failure
// @access  Public
export const googleAuthFailure = (_req: Request, res: Response) => {
  res.status(401).json({
    success: false,
    message: 'Google authentication failed',
  });
};

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { email } = req.body;

  // Validate email
  if (!email) {
    return next(new AppError('Email is required', 400));
  }

  // Call the forgot password service
  const result = await forgotPassword(email);
  
  // If email not found, still return success to prevent email enumeration
  if (!result.success) {
    // Log the error but still return success to the client
    console.error('Password reset request failed:', result.message);
  }

  // Always return success to prevent email enumeration
  res.status(201).json({
    success: true,
    message: 'If an account with that email exists, a password reset link has been sent.'
  });
});

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const { token, newPassword } = req.body;

  // Validate input
  if (!token || !newPassword) {
    return next(new AppError('Token and new password are required', 400));
  }

  // Validate password length
  if (newPassword.length < 6) {
    return next(new AppError('Password must be at least 6 characters long', 400));
  }

  // Call the reset password service
  const result = await resetPassword(token, newPassword);
  
  if (!result.success) {
    return next(new AppError(result.message, 400));
  }

  res.status(200).json({
    success: true,
    message: result.message
  });
});
