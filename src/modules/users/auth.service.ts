import { config } from '../../config/env';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { AppError } from '../../utils/appError';
import User, { IUser } from './user.model';
import { AuthResponse } from './types/user.types';
import { sendPasswordResetEmail } from '../../services/email.service';
import { logger } from '../../utils/logger';
import { validatePassword } from '../../utils/passwordValidator';

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
  
  // Use password validator for consistent validation
  const passwordValidation = validatePassword(password);
  if (!passwordValidation.isValid) {
    throw new AppError(passwordValidation.message, 400);
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

  // Check if password is available
  if (!user.password) {
    const error = new Error('Invalid email or password') as any;
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
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

// Generate OTP (6-digit code)
const generateOTP = (): { otp: string; expiresAt: Date } => {
  // Generate a 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Set OTP expiration to 15 minutes from now
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + 15);
  
  return {
    otp,
    expiresAt
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
  const operationTimeout = 250000;
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
            .select('+password +resetToken +resetTokenExpires +otp +otpExpires +otpVerified +isOAuthUser +authProvider +hasPassword')
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
            message: 'User not found.'
          };
        }

        // 2. Allow OAuth users to set/reset password (no blocking)
        let userDoc = Array.isArray(user) ? user[0] : user;

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
              message: `Please wait ${remainingTime} seconds before requesting another reset link.`
            };
          }
        }

        // 4. Generate and save new OTP (clear old OTP and verification status)
        logger.debug(`${logPrefix} [6/7] Generating new OTP...`);
        const { otp, expiresAt } = generateOTP();
        
        userDoc = Array.isArray(user) ? user[0] : user;
        await User.updateOne(
          { _id: (userDoc as any)._id },
          {
            $set: {
              otp: otp,
              otpExpires: expiresAt,
              otpVerified: false, // Reset verification status
              lastResetRequest: now
            },
            $unset: {
              resetToken: "", // Clear old token if exists
              resetTokenExpires: "" // Clear old token expiry
            }
          }
        );

        // 5. Send OTP email
        logger.info(`${logPrefix} [7/7] Sending password reset OTP...`);
        userDoc = Array.isArray(user) ? user[0] : user;
        await sendPasswordResetEmail((userDoc as any).email, otp);
        logger.info(`${logPrefix} [EMAIL_SENT] Password reset OTP sent to ${(userDoc as any).email}`);

        return {
          status: 1,
          message: 'Password reset OTP sent to your mail.'
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

    // Check if password is available
    if (!user.password) {
      return { 
        success: false, 
        message: 'Password is not set for this account. Please set a password first.' 
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

// Verify OTP
export const verifyOTP = async (email: string, otp: string): Promise<{ success: boolean; message: string }> => {
  const logPrefix = '🔵 [VERIFY_OTP]';
  try {
    // 1. Find user by email and OTP
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: new Date() }
    }).select('+otp +otpExpires +otpVerified');

    if (!user) {
      return { 
        success: false, 
        message: 'OTP is invalid, expired, or not verified. Please verify OTP first.' 
      };
    }

    // 2. Check if OTP is already verified
    if (user.otpVerified) {
      return { 
        success: false, 
        message: 'OTP has already been used. Please request a new OTP.' 
      };
    }

    // 3. Mark OTP as verified
    user.otpVerified = true;
    await user.save();

    logger.info(`${logPrefix} OTP verified successfully for email: ${email}`);
    return { 
      success: true, 
      message: 'OTP verified successfully.' 
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`❌ ${logPrefix} [ERROR] Error verifying OTP:`, {
      error: errorMessage,
      timestamp: new Date().toISOString()
    });
    return { 
      success: false, 
      message: 'An error occurred while verifying OTP.' 
    };
  }
};

// Reset password (requires verified OTP)
export const resetPassword = async (email: string, otp: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  const logPrefix = '🔵 [RESET_PASSWORD]';
  try {
    // 1. Find user by email with verified OTP
    const user = await User.findOne({
      email: email.toLowerCase().trim(),
      otp: otp,
      otpExpires: { $gt: new Date() },
      otpVerified: true
    }).select('+otp +otpExpires +otpVerified +isOAuthUser +hasPassword');

    if (!user) {
      return { 
        success: false, 
        message: 'OTP is invalid, expired, or not verified. Please verify OTP first.' 
      };
    }

    // 2. Validate new password
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return { 
        success: false, 
        message: passwordValidation.message 
      };
    }

    // 3. Update password and clear OTP fields
    user.password = newPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpVerified = undefined;
    
    // If OAuth user is setting password for first time, mark hasPassword = true
    if (user.isOAuthUser && !user.hasPassword) {
      user.hasPassword = true;
      logger.info(`${logPrefix} OAuth user setting password for first time: ${email}`);
    }
    
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

/**
 * Save or update Firebase user data
 * @param firebase_uid - Firebase user ID
 * @param email - User email
 * @param first_name - User first name
 * @param last_name - User last name
 * @returns Promise with saved/updated user data
 */
export const saveFirebaseUser = async (
  firebase_uid: string,
  email: string,
  first_name: string,
  last_name?: string
): Promise<IUser> => {
  try {
    // Validate required fields
    if (!firebase_uid || !email || !first_name) {
      throw new AppError('All fields (firebase_uid, email, first_name) are required', 400);
    }

    // Trim and normalize inputs
    const trimmedFirebaseUid = firebase_uid.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedFirstName = first_name.trim();
    const trimmedLastName = last_name?.trim() || '';

    // Check if user with this firebase_uid already exists
    let existingUser = await User.findOne({ firebase_uid: trimmedFirebaseUid });

    if (existingUser) {
      // Update existing user
      existingUser.email = trimmedEmail;
      existingUser.firstName = trimmedFirstName;
      if (trimmedLastName) {
        existingUser.lastName = trimmedLastName;
      }
      await existingUser.save();
      logger.info(`Updated Firebase user with UID: ${trimmedFirebaseUid}`);
      return existingUser;
    }

    // Check if user with same email already exists
    const existingEmailUser = await User.findOne({ email: trimmedEmail });

    if (existingEmailUser) {
      // Security check: If user already has a different firebase_uid, don't allow update
      if (existingEmailUser.firebase_uid && existingEmailUser.firebase_uid !== trimmedFirebaseUid) {
        throw new AppError('This email is already associated with a different Firebase account', 409);
      }
      
      // Update existing user with firebase_uid (only if no firebase_uid or same firebase_uid)
      existingEmailUser.firebase_uid = trimmedFirebaseUid;
      existingEmailUser.firstName = trimmedFirstName;
      if (trimmedLastName) {
        existingEmailUser.lastName = trimmedLastName;
      }
      existingEmailUser.authProvider = 'google';
      existingEmailUser.isOAuthUser = true;
      await existingEmailUser.save();
      logger.info(`Updated existing user with Firebase UID: ${trimmedFirebaseUid}`);
      return existingEmailUser;
    }

    // No existing user found - create new one
    // Generate username from email and ensure it's unique
    let emailPrefix = trimmedEmail.split('@')[0].toLowerCase();
    emailPrefix = emailPrefix.replace(/[^a-z0-9]/g, ''); // Remove special characters
    let generatedUsername = emailPrefix || 'user' + Math.random().toString(36).substring(2, 8);
    
    // Check if username already exists and generate unique one
    let counter = 1;
    const originalUsername = generatedUsername;
    while (await User.findOne({ username: generatedUsername })) {
      generatedUsername = `${originalUsername}${counter}`;
      counter++;
    }
    
    const newUser = await User.create({
      firebase_uid: trimmedFirebaseUid,
      email: trimmedEmail,
      firstName: trimmedFirstName,
      ...(trimmedLastName && { lastName: trimmedLastName }),
      username: generatedUsername,
      authProvider: 'google',
      isOAuthUser: true
    });
    
    logger.info(`Created new Firebase user with UID: ${trimmedFirebaseUid}`);
    return newUser;
  } catch (error: any) {
    logger.error('Error saving Firebase user:', error);
    
    // Handle duplicate key error (e.g., duplicate firebase_uid or email)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0];
      throw new AppError(`A user with this ${field} already exists`, 409);
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors || {}).map((err: any) => err.message);
      throw new AppError(messages[0] || 'Validation failed', 400);
    }
    
    // Re-throw AppError
    if (error instanceof AppError) {
      throw error;
    }
    
    throw new AppError('Failed to save Firebase user', 500);
  }
};

export {
  generateToken,
  formatUserResponse
};
