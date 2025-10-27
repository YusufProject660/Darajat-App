import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../../config/env';
import { IUser } from './user.model'; // Make sure this path is correct
import { register, login, getMe, forgotPassword, resetPassword, changePassword as changePasswordService, updateProfile, deleteUser } from './auth.service';
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

  // Input validation
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'Please provide both email and password',
      error: 'MISSING_CREDENTIALS'
    });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid email address',
      error: 'INVALID_EMAIL_FORMAT'
    });
  }

  try {
    const user = await login(email, password);
    
    // Generate JWT token
    const token = generateToken(user);

    // Prepare user data for response
    const userObj = user && typeof user === 'object' ? 
      (user.toObject ? user.toObject() : { ...user }) : {};
      
    const userWithoutPassword = { ...userObj };
    delete userWithoutPassword.password;
    delete userWithoutPassword.__v;

    // Set secure HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.status(200).json({
      success: true,
      token,
      data: userWithoutPassword,
      message: 'Login successful'
    });
  } catch (error: any) {
    console.error('Login error:', error);
    
    // Handle specific error cases with appropriate status codes and messages
    if (error.code === 'USER_NOT_FOUND') {
      return res.status(401).json({
        success: false,
        message: 'No account found with this email',
        error: 'USER_NOT_FOUND'
      });
    }

    if (error.code === 'INVALID_PASSWORD') {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password',
        error: 'INVALID_PASSWORD'
      });
    }

    if (error.code === 'MISSING_FIELDS') {
      return res.status(400).json({
        success: false,
        message: error.message || 'Email and password are required',
        error: 'MISSING_FIELDS'
      });
    }

    // Handle database errors
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please try again later.',
        error: 'SERVICE_UNAVAILABLE'
      });
    }

    // Default error response
    return res.status(500).json({
      success: false,
      message: 'An error occurred during login. Please try again later.',
      error: 'SERVER_ERROR'
    });
  }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export const getMeHandler = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user?._id) {
    return next(new AppError('User not authenticated', 401));
  }
  
  const user = await getMe(req.user._id.toString());
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  
  return res.status(200).json({
    success: true,
    data: user
  });
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
  return; // Explicit return to satisfy TypeScript
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

  if (!token || !newPassword) {
    return next(new AppError('Token and new password are required', 400));
  }

  const result = await resetPassword(token, newPassword);
  
  if (!result.success) {
    return next(new AppError(result.message, 400));
  }

  res.status(200).json({
    success: true,
    message: result.message
  });
});

// @desc    Change user password
// @route   POST /api/auth/change-password
// @access  Private
// @desc    Update user profile
// @route   PATCH /api/user/profile
// @access  Private
export const updateUserProfile = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { username, email, avatar } = req.body;
  
  // Validate request body
  if (!username && !email && !avatar) {
    return next(new AppError('At least one field (username, email, or avatar) is required to update profile', 400));
  }

  try {
    const updatedUser = await updateProfile(req.user!.id, { username, email, avatar });
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        userId: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        avatar: updatedUser.avatar
      }
    });
  } catch (error: any) {
    if (error.message === 'Email already in use' || error.message === 'Username already taken') {
      return next(new AppError(error.message, 400));
    }
    return next(new AppError('Failed to update profile', 500));
  }
});

// @desc    Change user password
// @route   PATCH /api/auth/change-password
// @access  Private
// @desc    Delete user account permanently
// @route   DELETE /api/user/delete
// @access  Private
export const deleteUserAccount = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const userId = req.user?.id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  try {
    const result = await deleteUser(userId);
    
    if (!result.success) {
      return next(new AppError(result.message, 404));
    }

    // Clear the JWT cookie if using cookie-based auth
    res.clearCookie('jwt');

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting account:', error);
    return next(new AppError('Failed to delete account. Please try again later.', 500));
  }
});

// @desc    Change user password
// @route   PATCH /api/auth/change-password
// @access  Private
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user?._id;

  if (!userId) {
    return next(new AppError('User not authenticated', 401));
  }

  if (!currentPassword || !newPassword) {
    return next(new AppError('Current password and new password are required', 400));
  }

  const result = await changePasswordService(userId.toString(), currentPassword, newPassword);

  if (!result.success) {
    return next(new AppError(result.message, 400));
  }

  res.status(200).json({
    success: true,
    message: result.message
  });
});
