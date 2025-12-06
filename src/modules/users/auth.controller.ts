import { Request, Response } from 'express';
import { IUser } from './user.model';
import { register, login, getMe, forgotPassword, resetPassword, verifyOTP, changePassword as changePasswordService, updateProfile, deleteUser, saveFirebaseUser, generateToken } from './auth.service';
import { addToBlacklist } from '../../utils/tokenBlacklist';
import { AppError } from '../../utils/appError';
import { AuthRequest } from './types/user.types';
import asyncHandler from '../../middlewares/async';
import { logger } from '../../utils/logger';

// Import the password validation utility
import { validatePassword } from '../../utils/passwordValidator';

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
export const registerUser = asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as { email?: string; password?: string; confirmPassword?: string };
    const { email, password, confirmPassword } = body;

    // Field-wise validation
    if (!email) {
      return res.status(200).json({ status: 0, message: 'Please enter your email.' });
    }

    if (!password) {
      return res.status(200).json({ status: 0, message: 'Please enter your password.' });
    }

    // Check if password contains only whitespace
    // Validate password format
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(200).json({ status: 0, message: passwordValidation.message });
    }

    if (password.trim().length === 0) {
      return res.status(200).json({ status: 0, message: 'Password cannot be empty.' });
    }

    if (!confirmPassword) {
      return res.status(200).json({ status: 0, message: 'Please enter your confirm password.' });
    }

    if (password !== confirmPassword) {
      return res.status(200).json({ status: 0, message: 'Passwords do not match.' });
    }

    // Strict email validation
const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Additional checks for invalid email patterns
if (!email || 
    !emailRegex.test(email) || 
    email.includes('..') || 
    /@\.|\.@|\.{2,}/.test(email) ||
    /\s/.test(email) ||
    /[\s<>\[\],;:\\"]/.test(email) ||
    /@.*@/.test(email) || // More than one @
    /^[^@]+\.[^@]+\.[^@]+$/.test(email.split('@')[1]) || // More than one dot after @
    email.split('@')[0].length > 64 ||
    email.split('@')[1].length > 255) {
  return res.status(200).json({
    status: 0,
    message: 'Invalid email format.'
  });
}

// Additional check for double TLDs like .com.com, .net.net, etc.
const domainPart = email.split('@')[1];
const domainParts = domainPart.split('.');
if (domainParts.length > 2) {
  const tld = domainParts[domainParts.length - 1];
  const secondLevel = domainParts[domainParts.length - 2];
  if (secondLevel === tld) {
    return res.status(200).json({
      status: 0,
      message: 'Invalid email format.'
    });
  }
}

    try {
      const body = req.body as { fullname?: string; username?: string };
      const { fullname, username } = body;
      const user = await register(email, password, confirmPassword, username, fullname);
      
      // Set the token in the response header
      res.setHeader('Authorization', `Bearer ${user.token}`);
      
      // Prepare response data
      const responseData = {
        user_id: user.id,
        email: user.email,
        role: user.role,
        token: user.token
      };
      
      return res.status(200).json({
        status: 1,
        message: 'Signup successful.',
        data: responseData
      });
    } catch (error: any) {
      logger.error('Registration error:', error);
      
      // Handle validation errors from Mongoose
      if (error.name === 'ValidationError') {
        const messages = [];
        // Extract all validation error messages
        for (const field in error.errors) {
          if (error.errors[field].message) {
            messages.push(error.errors[field].message);
          }
        }
        
        return res.status(200).json({
          status: 0,
          message: messages.length > 0 ? messages[0] : 'Validation failed. Please check your input.'
        });
      }
      
      // Handle duplicate key error (e.g., duplicate email)
      if (error.code === 11000) {
        return res.status(200).json({
          status: 0,
          message: 'This email is already registered. Please use a different email or login.'
        });
      }
      
      // Handle custom AppError
      if (error instanceof AppError) {
        return res.status(200).json({
          status: 0,
          message: error.message
        });
      }
      
      // For any other unhandled errors
      return res.status(200).json({
        status: 0,
        message: 'Something went wrong. Please try again later.'
      });
    }
  } catch (error) {
    // This is the outer try-catch block's catch
    logger.error('Unexpected error in registerUser:', error);
    return res.status(200).json({
      status: 0,
      message: 'An unexpected error occurred. Please try again.'
    });
  }
});

// @desc    Authenticate a user
// @route   POST /api/auth/login
// @access  Public
export const loginUser = asyncHandler(async (req: Request, res: Response) => {
  // Trim and validate input fields
  const body = req.body as { email?: string; password?: string };
  const email = body.email?.trim();
  const password = body.password?.trim();

  // Validate required fields
  if (!email && !password) {
    return res.status(200).json({ 
      status: 0, 
      message: 'Email and password are required.' 
    });
  }
  if (!email) {
    return res.status(200).json({ 
      status: 0, 
      message: 'Please enter your email address.' 
    });
  }
  if (!password) {
    return res.status(200).json({ 
      status: 0, 
      message: 'Please enter your password.' 
    });
  }

  // Validate email format with comprehensive checks
  const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
  if (
    !emailRegex.test(email) ||
    email.includes('..') ||
    /@\.|\.@|\.{2,}/.test(email) ||
    /\s/.test(email) ||
    /[\s<>\[\],;:\\"]/.test(email) ||
    /@.*@/.test(email) ||
    /^[^@]+\.[^@]+\.[^@]+$/.test(email.split('@')[1]) ||
    email.split('@')[0].length > 64 ||
    email.split('@')[1].length > 255 ||
    /\.[A-Za-z]+\.(com|net|org|in)$/i.test(email.split('@')[1])
  ) {
    return res.status(200).json({
      status: 0,
      message: 'Invalid email format.'
    });
  }

  try {
    const user = await login(email, password);
    
    // Use the token generated by the auth service to keep payload consistent
    const token = user.token;

    // Set the token in an HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    // Return user data and token using response formatter
    return res.apiSuccess({
      user_id: user.id,
      email: user.email,
      role: user.role,
      token
    }, 'Login successful');
  } catch (error: any) {
    // Handle specific error cases from auth service
    if (error.code === 'INVALID_CREDENTIALS' || error.code === 'USER_NOT_FOUND') {
      return res.status(200).json({
        status: 0,
        message: 'Invalid email or password.'
      });
    }
    
    if (error.code === 'OAUTH_ACCOUNT') {
      return res.status(200).json({
        status: 0,
        message: 'This account was created with Google. Please sign in with Google instead of email and password.'
      });
    }
    
    // Pass other errors to the global error handler
    throw error;
  }
  return;
});
// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
export const getMeHandler = asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(200).json({ status: 0, message: 'User not authenticated' });
    }
    
    const user = await getMe(req.user.id);
    
    // Format the response to match the required structure
    return res.status(200).json({
      status: 1,
      message: 'User profile fetched successfully',
      data: {
        id: user.id,
        username: user.username,
        firstName: user.firstName,
        ...(user.lastName && { lastName: user.lastName }),
        email: user.email,
        ...(user.avatar && { avatar: user.avatar }),
        role: user.role,
        stats: {
          gamesPlayed: user.stats.gamesPlayed,
          accuracy: user.stats.accuracy,
          bestScore: user.stats.bestScore
        },
        token: user.token
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'User not found') {
      return res.status(200).json({ status: 0, message: 'User not found' });
    }
    throw error;
  }
});

// @desc    Logout user / clear token
// @route   POST /api/auth/logout
// @access  Private
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  // Get token from header
  const authHeader = (req.headers as any).authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(200).json({
      status: 0,
      message: 'No token provided'
    });
  }

  const token = authHeader.split(' ')[1];
  
  // Add the token to the blacklist
  addToBlacklist(token);

  // Clear the JWT token cookie if you're using cookies
  res.clearCookie('jwt');

  return res.status(200).json({
    status: 1,
    message: 'User logged out successfully'
  });
});

// @desc    Check if user is admin
// @route   GET /api/auth/admin
// @access  Private/Admin
export const isAdmin = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(200).json({ status: 0, message: 'Not authorized to access this route' });
  }
  
  return res.status(200).json({
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
    if (!(req as any).user) {
      return res.redirect('/api/auth/google/failure');
    }
    
    // Generate token
    const token = generateToken((req as any).user as unknown as IUser);
    
    // Redirect to success with token
    return res.redirect(`/api/auth/google/success?token=${token}`);
  } catch (error) {
    logger.error('Google OAuth callback error:', error);
    return res.redirect('/api/auth/google/failure');
  }
};

// @desc    Google OAuth success
// @route   GET /api/auth/google/success
// @access  Public
export const googleAuthSuccess = (req: Request, res: Response) => {
  try {
    const { token } = (req as any).query;
    
    if (!token) {
      return res.status(200).json({
        status: 0,
        message: 'No token provided'
      });
    }
    
    return res.status(200).json({
      status: 1,
      message: 'Google authentication successful',
      data: { token }
    });
  } catch (error) {
    logger.error('Google OAuth success error:', error);
    return res.status(200).json({
      status: 0,
      message: 'Internal server error'
    });
  }
};

// @desc    Google OAuth failure
// @route   GET /api/auth/google/failure
// @access  Public
export const googleAuthFailure = (_req: Request, res: Response) => {
  res.status(200).json({
    status: 0,
    message: 'Google authentication failed',
  });
  return; // Explicit return to satisfy TypeScript
};

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
export const requestPasswordReset = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { email?: string };
  const { email } = body;
  
  // Validate email presence
  if (!email) {
    return res.status(200).json({
      status: 0,
      message: 'Email is required.'
    });
  }

  // Normalize the email by trimming whitespace
  const normalizedEmail = email.trim();

  // If email is empty after trimming
  if (!normalizedEmail) {
    return res.status(200).json({
      status: 0,
      message: 'Email is required.'
    });
  }

  // Enhanced email format validation
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(normalizedEmail) || normalizedEmail.includes('..') || 
      normalizedEmail.endsWith('.') || normalizedEmail.includes('.@') ||
      (normalizedEmail.split('@')[1].match(/\./g) || []).length > 1) {
    return res.status(200).json({
      status: 0,
      message: 'Invalid email format.'
    });
  }

  try {
    logger.info('🔑 [1/3] Starting password reset request for email:', normalizedEmail);
    
    // Call the forgot password service
    logger.info('🔑 [2/3] Calling forgotPassword service...');
    const result = await forgotPassword(normalizedEmail);
    
    // Check the result status
    if (result.status === 0) {
      logger.warn('⚠️ [3/3] Password reset request failed:', {
        code: result.code,
        message: result.message,
        remainingTime: result.remainingTime
      });
      
      // Handle cooldown response
      if (result.code === 'RESET_COOLDOWN') {
        return res.status(200).json({
          status: 0,
          message: result.message,
          remainingTime: result.remainingTime,
          code: 'RESET_COOLDOWN'
        });
      }
      
      // Handle user not found or other errors
      return res.status(200).json({
        status: 0,
        message: result.message || 'No account found with this email address.',
        code: result.code || 'UNKNOWN_ERROR'
      });
    }
    
    logger.info('✅ [3/3] Password reset email sent successfully');
    
    // Return success response
    return res.status(200).json({
      status: 1,
      message: 'If an account with this email exists, you will receive a password reset link.',
      code: 'EMAIL_SENT'
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('❌ [ERROR] Failed to process password reset request:', {
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString()
    });
    
    // Return a generic error message to the client
    return res.status(500).json({
      status: 0,
      message: 'An error occurred while processing your request. Please try again later.',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

// @desc    Verify OTP
// @route   POST /api/auth/verify-otp
// @access  Public
export const verifyOTPHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { email?: string; otp?: string };
    let { email, otp } = body;

    // Trim whitespace from inputs
    email = email?.trim();
    otp = otp?.trim();

    // Validate email
    if (!email) {
      res.status(200).json({
        status: 0,
        message: 'Email is required'
      });
      return;
    }

    // Validate OTP
    if (!otp) {
      res.status(200).json({
        status: 0,
        message: 'OTP is required'
      });
      return;
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      res.status(200).json({
        status: 0,
        message: 'OTP must be a 6-digit number'
      });
      return;
    }

    const result = await verifyOTP(email, otp);
    
    if (!result.success) {
      res.status(200).json({
        status: 0,
        message: result.message
      });
      return;
    }

    res.status(200).json({
      status: 1,
      message: result.message || 'OTP verified successfully'
    });
  } catch (error) {
    logger.error('Error in verifyOTPHandler:', error);
    res.status(200).json({
      status: 0,
      message: 'An error occurred while verifying OTP'
    });
  }
};

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as any;
    
    // Handle case-insensitive field names
    let email = (body.email || body.Email || body.EMAIL)?.trim();
    let otp = (body.otp || body.Otp || body.OTP)?.trim();
    let password = (body.password || body.Password || body.PASSWORD)?.trim();
    let confirmPassword = (body.confirmPassword || body.ConfirmPassword || body.CONFIRMPASSWORD || body.confirmpassword)?.trim();

    // Validate email
    if (!email) {
      res.status(200).json({
        status: 0,
        message: 'Email is required'
      });
      return;
    }

    // Validate OTP
    if (!otp) {
      res.status(200).json({
        status: 0,
        message: 'OTP is required'
      });
      return;
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      res.status(200).json({
        status: 0,
        message: 'OTP must be a 6-digit number'
      });
      return;
    }

    // Validate passwords
    if (!password || !confirmPassword) {
      res.status(200).json({
        status: 0,
        message: 'Both password and confirm password are required'
      });
      return;
    }

    if (password !== confirmPassword) {
      res.status(200).json({
        status: 0,
        message: 'Passwords do not match'
      });
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      res.status(200).json({
        status: 0,
        message: passwordValidation.message
      });
      return;
    }

    const result = await resetPassword(email, otp, password);
    
    if (!result.success) {
      res.status(200).json({
        status: 0,
        message: result.message
      });
      return;
    }

    res.status(200).json({
      status: 1,
      message: result.message || 'Password has been reset successfully'
    });
  } catch (error) {
    logger.error('Error in resetPasswordHandler:', error);
    res.status(200).json({
      status: 0,
      message: 'An error occurred while resetting your password'
    });
  }
};

// @desc    Change user password
// @route   POST /api/auth/change-password
// @access  Private
// @desc    Update user profile
// @route   PATCH /api/user/profile
// @access  Private
export const updateUserProfile = asyncHandler(async (req: AuthRequest, res: Response) => {
  const body = req.body as { firstName?: string; lastName?: string; email?: string };
  const { firstName, lastName, email } = body;
  
  // Validate request body
  if (!firstName && !lastName && !email) {
    return res.status(200).json({ status: 0, message: 'At least one field (firstName, lastName, or email) is required to update profile' });
  }

  try {
    const updatedUser = await updateProfile(req.user!.id, { firstName, lastName, email });
    const { token, ...sanitizedUser } = updatedUser;
    
    return res.apiSuccess({
      userId: sanitizedUser.id,
      username: sanitizedUser.username,
      email: sanitizedUser.email,
      firstName: sanitizedUser.firstName,
      lastName: sanitizedUser.lastName
    }, 'Profile updated successfully');
  } catch (error: any) {
    if (error.message === 'Email already in use' || error.message === 'Username already taken') {
      return res.status(200).json({ status: 0, message: error.message });
    }
    return res.status(200).json({ status: 0, message: 'Failed to update profile' });
  }
});

// @desc    Change user password
// @route   PATCH /api/auth/change-password
// @access  Private
// @desc    Delete user account permanently
// @route   DELETE /api/user/delete
// @access  Private
export const deleteUserAccount = asyncHandler(async (req: AuthRequest, res: Response) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(200).json({
      status: 0,
      message: 'User not authenticated'
    });
  }

  try {
    const result = await deleteUser(userId);
    
    if (!result.success) {
      // Return a simplified response with only status and message
      return res.status(200).json({
        status: 0,
        message: result.message
      });
    }

    // Clear the JWT cookie if using cookie-based auth
    res.clearCookie('jwt');

    return res.status(200).json({
      status: 1,
      message: 'Account deleted successfully'
    });
  } catch (error: any) {
    logger.error('Error deleting account:', error);
    return res.status(200).json({
      status: 0,
      message: 'Failed to delete account. Please try again later.'
    });
  }
});

// @desc    Change user password
// @route   PATCH /api/auth/change-password
// @access  Private
export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  // Trim all input fields
  const body = req.body as { currentPassword?: string; newPassword?: string; confirmNewPassword?: string };
  const currentPassword = body.currentPassword?.trim() || '';
  const newPassword = body.newPassword?.trim() || '';
  const confirmNewPassword = body.confirmNewPassword?.trim() || '';
  const userId = req.user?.id;

  if (!userId) {
    return res.status(200).json({ status: 0, message: 'User not authenticated' });
  }

  // Check if all fields are empty after trimming
  if (!currentPassword && !newPassword && !confirmNewPassword) {
    return res.status(200).json({
      status: 0,
      message: 'CurrentPassword, newPassword and confirmNewPassword are required'
    });
  }

  // Check individual required fields after trimming
  if (!currentPassword) {
    return res.status(200).json({
      status: 0,
      message: 'Please enter currentPassword'
    });
  }

  if (!newPassword) {
    return res.status(200).json({
      status: 0,
      message: 'Please enter newPassword'
    });
  }

  if (!confirmNewPassword) {
    return res.status(200).json({
      status: 0,
      message: 'Please enter confirmNewPassword'
    });
  }

  // Validate new password using validator for consistency
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.isValid) {
    return res.status(200).json({
      status: 0,
      message: passwordValidation.message
    });
  }

  // Check if new passwords match after trimming
  if (newPassword !== confirmNewPassword) {
    return res.status(200).json({
      status: 0,
      message: 'NewPassword and confirmPassword do not match.'
    });
  }

  const result = await changePasswordService(userId.toString(), currentPassword, newPassword);

  if (!result.success) {
    return res.status(200).json({
      status: 0,
      message: result.message
    });
  }

  return res.status(200).json({
    status: 1,
    message: result.message
  });
});

// @desc    Save or update Firebase user
// @route   POST /api/auth/firebase-google
// @access  Public
export const saveFirebaseUserHandler = asyncHandler(async (req: Request, res: Response) => {
  try {
    const body = req.body as { 
      firebase_uid?: string; 
      email?: string; 
      first_name?: string; 
      last_name?: string;
    };
    
    const { firebase_uid, email, first_name, last_name } = body;

    // Validate required fields
    if (!firebase_uid) {
      return res.status(200).json({
        status: 0,
        message: 'firebase_uid is required'
      });
    }

    if (!email) {
      return res.status(200).json({
        status: 0,
        message: 'email is required'
      });
    }

    if (!first_name) {
      return res.status(200).json({
        status: 0,
        message: 'first_name is required'
      });
    }

    if (!last_name) {
      return res.status(200).json({
        status: 0,
        message: 'last_name is required'
      });
    }

    // Validate email format
    const emailRegex = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
    if (
      !emailRegex.test(email) ||
      email.includes('..') ||
      /@\.|\.@|\.{2,}/.test(email) ||
      /\s/.test(email) ||
      /[\s<>\[\],;:\\"]/.test(email) ||
      /@.*@/.test(email) ||
      email.split('@')[0].length > 64 ||
      email.split('@')[1].length > 255
    ) {
      return res.status(200).json({
        status: 0,
        message: 'Invalid email format.'
      });
    }

    // Call service to save/update Firebase user
    const user = await saveFirebaseUser(firebase_uid, email, first_name, last_name);

    // Generate token for the user
    const token = generateToken(user);

    // Set the token in the response header
    res.setHeader('Authorization', `Bearer ${token}`);

    return res.status(200).json({
      status: 1,
      message: 'Firebase user saved successfully',
      data: {
        id: user._id.toString(),
        firebase_uid: user.firebase_uid,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        token: token,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error: any) {
    logger.error('Error in saveFirebaseUserHandler:', error);

    // Handle AppError
    if (error instanceof AppError) {
      return res.status(200).json({
        status: 0,
        message: error.message
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = [];
      for (const field in error.errors) {
        if (error.errors[field].message) {
          messages.push(error.errors[field].message);
        }
      }
      return res.status(200).json({
        status: 0,
        message: messages.length > 0 ? messages[0] : 'Validation failed. Please check your input.'
      });
    }

    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(200).json({
        status: 0,
        message: 'A user with this information already exists.'
      });
    }

    // Generic error
    return res.status(200).json({
      status: 0,
      message: 'Failed to save Firebase user. Please try again later.'
    });
  }
});
