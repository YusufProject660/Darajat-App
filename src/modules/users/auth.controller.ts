import { Response } from 'express';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { config } from '../../config/env';
import { IUser } from './user.model';
import { register, login, getMe, forgotPassword, resetPassword, changePassword as changePasswordService, updateProfile, deleteUser } from './auth.service';
import { addToBlacklist } from '../../utils/tokenBlacklist';
import { AppError } from '../../utils/appError';
import { AuthRequest } from './types/user.types';
import asyncHandler from '../../middlewares/async';
import { logger } from '../../utils/logger';

// Import the password validation utility
import { validatePassword } from '../../utils/passwordValidator';

// Helper function to generate JWT token
const generateToken = (user: IUser): string => {
  return jwt.sign(
    { 
      id: user._id,
      role: user.role 
    },
    config.jwtSecret, 
    { expiresIn: '100y' }
  );
}

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
      return res.apiError(
        error.message || 'This account uses OAuth for authentication. Please sign in with your OAuth provider.',
        'OAUTH_AUTH_REQUIRED'
      );
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

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access Public
// @desc    Reset Password Page
// @route   GET /api/auth/reset-password
// @access  Public
export const resetPasswordPage = async (req: Request, res: Response): Promise<void> => {
    try {
        const { token } = (req as any).query as { token?: string };
        
        if (!token) {
            res.status(400).send('Invalid or missing reset token');
            return;
        }

        // Create public directory if it doesn't exist
        const publicDir = path.join(__dirname, '../../../public');
        if (!fsSync.existsSync(publicDir)) {
            logger.debug(`Creating public directory at: ${publicDir}`);
            await fs.mkdir(publicDir, { recursive: true });
        }

        const filePath = path.join(publicDir, 'reset-password.html');
        logger.debug(`Looking for reset password HTML at: ${filePath}`);
        
        // Check if file exists, if not create it
        if (!fsSync.existsSync(filePath)) {
            logger.info('Reset password HTML not found, creating new one...');
            await fs.writeFile(filePath, getResetPasswordHTML(), 'utf-8');
        }

        let html = await fs.readFile(filePath, 'utf-8');
        
        // Inject the token into the HTML
        html = html.replace(
            'id="token" value=""', 
            `id="token" value="${token}"`
        );
        
        // Set content type to HTML
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (error) {
        logger.error('Error serving reset password page:', error);
        res.status(500).send('An error occurred while loading the reset password page');
    }
};

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access  Public
export const resetPasswordHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as { token?: string; password?: string; confirmPassword?: string };
    let { token, password, confirmPassword } = body;

    // Trim whitespace from inputs
    token = token?.trim();
    password = password?.trim();
    confirmPassword = confirmPassword?.trim();

    // Validate token
    if (!token) {
      res.status(200).json({
        status: 0,
        message: 'Token is required'
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

    const result = await resetPassword(token, password);
    
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

// Helper function to generate the reset password HTML
const getResetPasswordHTML = () => {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Password - Darajat</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                margin: 0;
                padding: 20px;
                background-color: #f5f7fa;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
            }
            .container {
                background: white;
                padding: 2rem;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                max-width: 400px;
                width: 100%;
            }
            h2 {
                color: #2d3748;
                margin-top: 0;
                text-align: center;
            }
            .form-group {
                margin-bottom: 1.5rem;
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #4a5568;
                font-weight: 500;
            }
            input[type="password"] {
                width: 100%;
                padding: 0.75rem;
                border: 1px solid #e2e8f0;
                border-radius: 4px;
                font-size: 1rem;
                transition: border-color 0.2s;
            }
            input[type="password"]:focus {
                outline: none;
                border-color: #4299e1;
                box-shadow: 0 0 0 3px rgba(66, 153, 225, 0.2);
            }
            button {
                width: 100%;
                background-color: #4299e1;
                color: white;
                border: none;
                padding: 0.75rem;
                border-radius: 4px;
                font-size: 1rem;
                font-weight: 500;
                cursor: pointer;
                transition: background-color 0.2s;
            }
            button:hover {
                background-color: #3182ce;
            }
            .error-message {
                color: #e53e3e;
                margin-top: 0.5rem;
                font-size: 0.875rem;
            }
            .success-message {
                color: #38a169;
                margin-top: 0.5rem;
                font-size: 0.875rem;
            }
            .password-requirements {
                font-size: 0.75rem;
                color: #718096;
                margin-top: 0.25rem;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Reset Your Password</h2>
            <div id="error-message" class="error-message"></div>
            <div id="success-message" class="success-message"></div>
            <form id="resetForm">
                <input type="hidden" id="token" name="token" value="" />
                
                <div class="form-group">
                    <label for="password">New Password</label>
                    <input 
                        type="password" 
                        id="password" 
                        name="password" 
                        placeholder="Enter your new password" 
                        required 
                        minlength="8"
                        pattern="^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$"
                    />
                    <div class="password-requirements">
                        Must be at least 8 characters long and include uppercase, lowercase, number, and special character.
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="confirmPassword">Confirm New Password</label>
                    <input 
                        type="password" 
                        id="confirmPassword" 
                        name="confirmPassword" 
                        placeholder="Confirm your new password" 
                        required
                    />
                </div>
                
                <button type="submit" id="submitBtn">Reset Password</button>
            </form>
        </div>

        <script>
            // Extract token from URL
            const urlParams = new URLSearchParams(window.location.search);
            const token = urlParams.get('token');
            
            if (token) {
                document.getElementById('token').value = token;
            } else {
                document.getElementById('error-message').textContent = 'Invalid or missing reset token';
                document.getElementById('resetForm').style.display = 'none';
            }

            document.getElementById('resetForm').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const password = document.getElementById('password').value;
                const confirmPassword = document.getElementById('confirmPassword').value;
                const errorMessage = document.getElementById('error-message');
                const successMessage = document.getElementById('success-message');
                const submitBtn = document.getElementById('submitBtn');
                
                // Clear previous messages
                errorMessage.textContent = '';
                successMessage.textContent = '';
                
                // Validate passwords match
                if (password !== confirmPassword) {
                    errorMessage.textContent = 'Passwords do not match';
                    return;
                }
                
                // Validate password strength
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$/;
                if (!passwordRegex.test(password)) {
                    errorMessage.textContent = 'Password must be at least 8 characters long and include uppercase, lowercase, number, and special character.';
                    return;
                }
                
                try {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Processing...';
                    
                    const response = await fetch('/api/auth/reset-password', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            token: document.getElementById('token').value,
                            password: password,
                            confirmPassword: confirmPassword
                        })
                    });
                    
                    const data = await response.json();
                    
                    if (!response.ok) {
                        throw new Error(data.message || 'Failed to reset password');
                    }
                    
                    successMessage.textContent = data.message || 'Password has been reset successfully!';
                    this.reset();
                    
                    // Redirect to login after 3 seconds
                    setTimeout(() => {
                        window.location.href = '/login';
                    }, 3000);
                    
                } catch (error) {
                    logger.error('Error:', error);
                    errorMessage.textContent = error.message || 'An error occurred while resetting your password. Please try again.';
                } finally {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Reset Password';
                }
            });
            
            // Real-time password matching
            document.getElementById('confirmPassword').addEventListener('input', function() {
                const password = document.getElementById('password').value;
                const confirmPassword = this.value;
                const errorMessage = document.getElementById('error-message');
                
                if (confirmPassword && password !== confirmPassword) {
                    errorMessage.textContent = 'Passwords do not match';
                } else if (errorMessage.textContent === 'Passwords do not match') {
                    errorMessage.textContent = '';
                }
            });
        </script>
    </body>
    </html>`;
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

  // Validate new password length
  if (newPassword.length < 8) {
    return res.status(200).json({
      status: 0,
      message: 'newPassword must be at least 8 characters long'
    });
  }

  if (newPassword.length > 20) {
    return res.status(200).json({
      status: 0,
      message: 'Password must not exceed 20 characters'
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
