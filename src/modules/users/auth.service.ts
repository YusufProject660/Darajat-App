import { config } from '../../config/env';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { AppError } from '../../utils/appError';
import User, { IUser } from './user.model';
import { AuthResponse } from './types/user.types';
import { sendPasswordResetEmail } from '../../services/email.service';
import { logger } from '../../utils/logger';

const SALT_ROUNDS = 10;

const generateToken = (user: IUser): string => {
  try {
    // Make sure to convert ObjectId to string
    const userId = user._id?.toString();
    
    if (!userId) {
      throw new AppError('User ID is required', 400);
    }

    const payload = {
      id: userId,
      role: user.role || 'player',
      email: user.email,
      username: user.username
    };

    const token = jwt.sign(
      payload,
      config.jwtSecret,
      { 
        expiresIn: '100y',
        algorithm: 'HS256'
      }
    );
    
    return token;
  } catch (error) {
    logger.error('Error generating token:', error);
    throw new AppError('Failed to generate authentication token', 500);
  }
};

const formatUserResponse = (user: IUser, token: string): AuthResponse => ({
  id: user._id.toString(),
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  role: user.role,
  stats: {
    gamesPlayed: user.stats.gamesPlayed,
    accuracy: user.stats.accuracy,
    bestScore: user.stats.bestScore
  },
  token
});

export const register = async (email: string, password: string, _confirmPassword?: string, username?: string, fullname?: string): Promise<AuthResponse> => {
  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new AppError('A user with this email already exists', 409);
  }
  
  // Generate username from email if not provided
  let generatedUsername = username;
  if (!generatedUsername) {
    generatedUsername = email.split('@')[0].toLowerCase();
    // Remove any non-alphanumeric characters from the username
    generatedUsername = generatedUsername.replace(/[^a-z0-9]/g, '');
    // Ensure username is not empty after cleaning
    if (!generatedUsername) {
      generatedUsername = 'user' + Math.random().toString(36).substring(2, 8);
    }
    
    // Check if the generated username is already taken
    let counter = 1;
    const originalUsername = generatedUsername;
    while (await User.findOne({ username: generatedUsername })) {
      generatedUsername = `${originalUsername}${counter}`;
      counter++;
    }
  } else {
    // If username is provided, check if it's taken
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      throw new AppError('This username is already taken', 409);
    }
  }
  
  // Set fullname to the generated username if not provided
  const userFullname = fullname || generatedUsername;

  // Validate password
  if (!password) {
    throw new AppError('Password is required', 400);
  }
  
  // Check for whitespace-only password
  if (password.trim().length === 0) {
    throw new AppError('Password cannot be empty', 400);
  }
  
  if (password.length < 6) {
    throw new AppError('Password must be at least 6 characters long', 400);
  }

  // Create user with plain password - the pre-save hook will handle hashing
  const userData: any = {
    email,
    username: generatedUsername,
    firstName: userFullname,
    password: password, // Pre-save hook will hash this
    role: 'player',
    authProvider: 'email',
    isOAuthUser: false,
    hasPassword: true, // Explicitly set hasPassword for email-based users
    stats: {
      gamesPlayed: 0,
      accuracy: 0,
      bestScore: 0
    }
  };
  
  const user = await User.create(userData);

  if (!user) {
    throw new AppError('Failed to create user', 500);
  }
  
  const token = generateToken(user);
  return formatUserResponse(user, token);
};

export const login = async (email: string, password: string): Promise<AuthResponse> => {
  // Validate input
  if (!email || !password) {
    const error = new Error('Email and password are required') as any;
    error.statusCode = 400;
    error.code = 'MISSING_FIELDS';
    throw error;
  }

  // Check if user exists
  const user = await User.findOne({ email }).select('+password');
  
  if (!user) {
    const error = new Error('No account found with this email') as any;
    error.statusCode = 401;
    error.code = 'USER_NOT_FOUND';
    throw error;
  }

  // Check if this is an OAuth user trying to log in with password
  if (user.isOAuthUser || !user.password) {
    const error = new Error('This account uses OAuth for authentication. Please sign in with your OAuth provider.') as any;
    error.statusCode = 401;
    error.code = 'OAUTH_ACCOUNT';
    throw error;
  }

  // Secure password comparison using bcrypt
  try {
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Try one more time with trimmed password (in case of whitespace issues)
      const trimmedPassword = password.trim();
      if (trimmedPassword !== password) {
        const isTrimmedMatch = await bcrypt.compare(trimmedPassword, user.password);
        if (!isTrimmedMatch) {
          throw new AppError('Invalid email or password', 401);
        }
      } else {
        throw new AppError('Invalid email or password', 401);
      }
    }
  } catch (error) {
    const authError = new Error('Invalid email or password') as any;
    authError.statusCode = 401;
    authError.code = 'INVALID_CREDENTIALS';
    throw authError;
  }

  // Generate token and return user data
  const token = generateToken(user);
  return formatUserResponse(user, token);
};

export const getMe = async (userId: string): Promise<AuthResponse> => {
  const user = await User.findById(userId).select('-password');
  
  if (!user) {
    throw new Error('User not found');
  }
  
  const token = generateToken(user);
  return formatUserResponse(user, token);
};

// Generate reset token
const generateResetToken = (): { token: string; expiresAt: Date } => {
  // Generate a random token
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  // Set token expiration to 15 minutes from now
  const resetTokenExpires = new Date();
  resetTokenExpires.setMinutes(resetTokenExpires.getMinutes() + 15);
  
  return {
    token: resetToken,
    expiresAt: resetTokenExpires
  };
};

// Google OAuth authentication
export const googleAuth = async (profile: any): Promise<AuthResponse> => {
  // Check if user exists with this googleId
  let user = await User.findOne({ googleId: profile.id });

  if (!user) {
      // Create new OAuth user without a password
    user = await User.create({
      googleId: profile.id,
      email: profile.emails?.[0]?.value,
      username: profile.displayName || `user_${profile.id.slice(0, 8)}`,
      avatar: profile.photos?.[0]?.value,
      role: 'player',
      stats: {
        gamesPlayed: 0,
        accuracy: 0,
        bestScore: 0
      },
      // Mark as OAuth user and set auth provider
      authProvider: 'google',
      isOAuthUser: true
    });
  }

  // Generate token and return user data
  const token = generateToken(user);
  return formatUserResponse(user, token);
}

interface ForgotPasswordResponse {
  status: number;
  message: string;
  code?: string;
  remainingTime?: number;
}

export const forgotPassword = async (email: string): Promise<ForgotPasswordResponse> => {
  const logPrefix = '🔵 [FORGOT_PASSWORD]';
  logger.info(`${logPrefix} [1/7] Starting password reset for email:`, email);
  
  // Timeout for the entire operation (25 seconds)
  const operationTimeout = 25000;
  let timeoutId: NodeJS.Timeout | null = null;
  
  const handleError = (error: any, defaultMessage: string) => {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(`${logPrefix} [ERROR] ${err.message}`, {
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
    return {
      status: 0,
      message: defaultMessage,
      code: 'RESET_ERROR',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    };
  };

  try {
    // Set up the operation promise
    const operationPromise = (async (): Promise<ForgotPasswordResponse> => {
      try {
        // 1. Find the user by email with a timeout
        logger.debug(`${logPrefix} [2/7] Looking up user with email:`, email);
        
        // Race between the user lookup and a timeout
        const user = await Promise.race([
          User.findOne({ email })
            .select('+password +resetToken +resetTokenExpires +isOAuthUser +authProvider')
            .maxTimeMS(5000) // 5 second timeout for the query
            .lean(),
          new Promise<null>((_, reject) => 
            setTimeout(() => reject(new Error('User lookup timed out after 5s')), 5000)
          )
        ]);

        if (!user) {
          logger.info(`${logPrefix} [3/7] No user found with email:`, email);
          return {
            status: 0,
            message: 'If an account with this email exists, you will receive a password reset link.',
            code: 'USER_NOT_FOUND'
          };
        }

        // 2. Check if this is an OAuth user
        let userDoc = Array.isArray(user) ? user[0] : user;
        if (userDoc && (userDoc as any).isOAuthUser) {
          logger.info(`${logPrefix} [4/7] OAuth account detected:`, {
            email: (userDoc as any).email,
            provider: (userDoc as any).authProvider
          });
          return {
            status: 0,
            message: 'This account uses OAuth for authentication. Please sign in with your OAuth provider.',
            code: 'OAUTH_ACCOUNT'
          };
        }

        // 3. Check cooldown period (1 minute between requests)
        const COOLDOWN_PERIOD = 60 * 1000; // 1 minute
        const now = new Date();
        if (userDoc && (userDoc as any).lastResetRequest) {
          const timeSinceLastRequest = now.getTime() - new Date((userDoc as any).lastResetRequest).getTime();
          if (timeSinceLastRequest < COOLDOWN_PERIOD) {
            const remainingTime = Math.ceil((COOLDOWN_PERIOD - timeSinceLastRequest) / 1000);
            logger.warn(`${logPrefix} [5/7] Reset requested too soon. Please wait ${remainingTime} seconds.`);
            return {
              status: 0,
              message: `Please wait ${remainingTime} seconds before requesting another reset link.`,
              code: 'RESET_COOLDOWN',
              remainingTime
            };
          }
        }

        // 4. Generate and save reset token
        logger.debug(`${logPrefix} [6/7] Generating reset token...`);
        const { token, expiresAt } = generateResetToken();
        
        userDoc = Array.isArray(user) ? user[0] : user;
        await User.updateOne(
          { _id: (userDoc as any)._id },
          {
            $set: {
              resetPasswordToken: token,
              resetPasswordExpires: expiresAt,
              lastResetRequest: now
            }
          }
        );

        // 5. Send reset email (don't await this, respond immediately)
        logger.info(`${logPrefix} [7/7] Scheduling password reset email...`);
        const resetUrl = `${config.backendUrl || 'http://localhost:5000'}/reset-password?token=${token}`;
        
        // Don't await the email sending, just start it and respond
        userDoc = Array.isArray(user) ? user[0] : user;
        sendPasswordResetEmail((userDoc as any).email, resetUrl)
          .then(() => {
            logger.info(`${logPrefix} [EMAIL_SENT] Password reset email sent to ${(userDoc as any).email}`);
          })
          .catch((emailError) => {
            logger.error(`${logPrefix} [EMAIL_ERROR] Failed to send email:`, emailError);
          });

        return {
          status: 1,
          message: 'If an account with this email exists, you will receive a password reset link.'
        };

      } catch (error) {
        logger.error(`${logPrefix} [ERROR] Error in password reset:`, error);
        throw error;
      }
    })();

    // Race the operation against the timeout
    const timeoutPromise = new Promise<ForgotPasswordResponse>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Password reset operation timed out after 25 seconds'));
      }, operationTimeout);
    });

    return await Promise.race([operationPromise, timeoutPromise]);

  } catch (error) {
    return handleError(error, 'Failed to process password reset request');
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      logger.debug(`${logPrefix} [COMPLETE] Forgot password process completed for email:`, email);
    }
  }
};
/**
 * Change user password
 * @param userId - User ID
 * @param currentPassword - Current password for verification
 * @param newPassword - New password to set
 * @returns Promise with success status and message
 */
export const changePassword = async (userId: string, currentPassword: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  try {
    const user = await User.findById(userId).select('+password');
    
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Check if this is an OAuth user
    if (user.isOAuthUser || !user.password) {
      return { 
        success: false, 
        message: 'This account uses OAuth for authentication. Please use the OAuth provider to sign in.' 
      };
    }

    // Verify current password using bcrypt
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return { success: false, message: 'The currentPassword you entered is incorrect.' };
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return { success: false, message: 'New password cannot be the same as the current password.' };
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Update only the password field using findByIdAndUpdate to avoid validation issues
    await User.findByIdAndUpdate(userId, { 
      password: hashedPassword,
      updatedAt: new Date()
    });

    return { success: true, message: 'Password changed successfully.' };
  } catch (error) {
    logger.error('Change password error:', error);
    if (error instanceof Error) {
      return { 
        success: false, 
        message: error.message.includes('validation') 
          ? 'Invalid password format. ' + error.message 
          : 'An error occurred while changing password.' 
      };
    }
    return { success: false, message: 'An error occurred while changing password.' };
  }
};

/**
 * Set password for OAuth users who want to enable email/password login
 */
export const setPassword = async (userId: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  try {
    const user = await User.findById(userId);
    
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    // Only allow setting password for OAuth users who don't have a password
    if (!user.isOAuthUser || user.password) {
      return { 
        success: false, 
        message: 'Password cannot be set for this account.' 
      };
    }

    // Update user to email/password auth
    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    user.isOAuthUser = false;
    user.authProvider = 'email';
    
    await user.save();

    return { 
      success: true, 
      message: 'Password set successfully. You can now log in with your email and password.' 
    };
  } catch (error) {
    logger.error('Set password error:', error);
    return { success: false, message: 'Failed to set password. Please try again later.' };
  }
};

/**
 * Update user profile details
 */
export const updateProfile = async (
  userId: string,
  updateData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    username?: string;
  }
): Promise<AuthResponse> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError('User not found', 404);
  }

  // Check if email is being updated and if it already exists
  if (updateData.email && updateData.email !== user.email) {
    const emailExists = await User.findOne({ email: updateData.email });
    if (emailExists) {
      throw new AppError('Email already in use', 409);
    }
  }

  // Check if username is being updated and if it already exists
  if (updateData.username && updateData.username !== user.username) {
    const usernameExists = await User.findOne({ username: updateData.username });
    if (usernameExists) {
      throw new AppError('Username already taken', 409);
    }
  }

  // Update user fields
  if (typeof updateData.firstName === 'string') user.firstName = updateData.firstName;
  if (typeof updateData.lastName === 'string') user.lastName = updateData.lastName;
  if (typeof updateData.email === 'string') user.email = updateData.email;
  if (typeof updateData.username === 'string') user.username = updateData.username;

  const updatedUser = await user.save();
  const token = generateToken(updatedUser);

  return formatUserResponse(updatedUser, token);
};

/**
 * Permanently deletes a user account
 * @param userId - The ID of the user to delete
 * @returns Promise with success status and message
 */
export const deleteUser = async (userId: string): Promise<{ success: boolean; message: string }> => {
  try {
    const result = await User.findByIdAndDelete(userId);
    
    if (!result) {
      return { success: false, message: 'User not found' };
    }
    
    // Here you could add additional cleanup logic if needed
    // For example, deleting related data in other collections
    
    return { 
      success: true, 
      message: 'Account deleted successfully' 
    };
  } catch (error) {
    logger.error('Error deleting user account:', error);
    throw new AppError('Failed to delete account. Please try again later.', 500);
  }
};

export const resetPassword = async (token: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  const logPrefix = '🔵 [RESET_PASSWORD]';
  try {
    // 1. Find user by reset token and check if token is not expired
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return { 
        success: false, 
        message: 'Reset link is invalid or has expired.' 
      };
    }

    // 2. Update password
    // Just set the plain password - the pre-save hook will handle hashing it
    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    
    // This will trigger the pre-save hook to hash the password
    await user.save();

    return { 
      success: true, 
      message: 'Your password has been reset successfully. Please log in with your new password.' 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error(`❌ ${logPrefix} [ERROR] Unhandled error in resetPassword:`, {
      error: errorMessage,
      stack: errorStack,
      timestamp: new Date().toISOString()
    });
    
    // Re-throw the error to be caught by the outer try-catch
    throw error;
  }
}

export {
  generateToken,
  formatUserResponse
};
