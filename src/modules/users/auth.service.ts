import { config } from '../../config/env';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import User, { IUser } from './user.model';
import { sendPasswordResetEmail } from '../../config/email';

const SALT_ROUNDS = 10;

interface AuthResponse {
  id: string;
  username: string;
  email: string;
  avatar?: string;
  role: 'player' | 'admin';
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  token: string;
}

const generateToken = (user: IUser): string => {
  try {
    // Make sure to convert ObjectId to string
    const userId = user._id?.toString();
    
    if (!userId) {
      throw new Error('User ID is required');
    }

    const payload = {
      id: userId,
      role: user.role || 'player',
      email: user.email,
      username: user.username
    };

    // Log the payload for debugging
    console.log('JWT Payload:', JSON.stringify(payload, null, 2));

    const token = jwt.sign(
      payload,
      config.jwtSecret,
      { 
        expiresIn: '100y',
        algorithm: 'HS256'
      }
    );

    // Log the generated token for debugging
    console.log('Generated Token:', token);
    
    return token;
  } catch (error) {
    console.error('Error generating token:', error);
    throw new Error('Failed to generate authentication token');
  }
};

const formatUserResponse = (user: IUser, token: string): AuthResponse => ({
  id: user._id.toString(),
  username: user.username,
  email: user.email,
  avatar: user.avatar,
  role: user.role,
  stats: {
    gamesPlayed: user.stats.gamesPlayed,
    accuracy: user.stats.accuracy,
    bestScore: user.stats.bestScore
  },
  token
});

export const register = async (username: string, email: string, password: string, confirmPassword?: string): Promise<AuthResponse> => {
  // Check if user exists
  const userExists = await User.findOne({ $or: [{ email }, { username }] });
  if (userExists) {
    throw new Error('User with this email or username already exists');
  }

  // Validate password
  if (!password) {
    throw new Error('Password is required');
  }
  
  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  // Create user with plain password - the pre-save hook will handle hashing
  const user = await User.create({
    username,
    email,
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
  });

  if (!user) {
    throw new Error('Failed to create user');
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
          throw new Error('Invalid email or password');
        }
      } else {
        throw new Error('Invalid email or password');
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

// Consistent response message to prevent email enumeration
const FORGOT_PASSWORD_RESPONSE = {
  success: true,
  message: 'If an account with that email exists, a password reset link has been sent.'
};

export const forgotPassword = async (email: string): Promise<{ success: boolean; message: string }> => {
  console.log('\n🔍 Starting password reset process for email:', email);
  
  try {
    // 1. Find user by email and explicitly include the password field
    console.log('🔎 Looking up user in database...');
    const user = await User.findOne({ email }).select('+password');
    
    if (!user) {
      console.log('ℹ️ No user found with email:', email);
      // Return success to prevent email enumeration
      return FORGOT_PASSWORD_RESPONSE;
    }
    
    console.log('✅ User found:', {
      id: user._id,
      email: user.email,
      isOAuthUser: user.isOAuthUser,
      hasPasswordField: !!user.password,
      authProvider: user.authProvider,
      createdAt: user.createdAt,
      passwordStartsWith: user.password ? user.password.substring(0, 10) + '...' : 'no password'
    });
    
    // Log more user details for debugging
    console.log('ℹ️ User auth details:', {
      resetTokenExists: !!user.resetToken,
      resetTokenExpires: user.resetTokenExpires,
      hasGoogleId: !!user.googleId
    });

    // Check if this is an OAuth user
    if (user.isOAuthUser) {
      console.log('ℹ️ Account uses OAuth:', {
        email: user.email,
        authProvider: user.authProvider
      });
      
      return {
        success: true,
        message: 'This account uses OAuth for authentication. Please sign in with your OAuth provider.'
      };
    }
    
    // Check if password is set and is a valid bcrypt hash
    const hasValidPassword = user.password && 
      (user.password.startsWith('$2a$') || 
       user.password.startsWith('$2b$') || 
       user.password.startsWith('$2y$'));
       
    if (!hasValidPassword) {
      console.log('ℹ️ Account has no valid password set:', {
        email: user.email,
        hasPassword: !!user.password
      });
      
      return {
        success: true,
        message: 'This account has no password set. Please use the sign-up process to set a password.'
      };
    }

    // 2. Generate reset token
    console.log('🔑 Generating reset token...');
    const { token, expiresAt } = generateResetToken();
    
    // 3. Save the reset token and expiry to the user document
    console.log('💾 Saving reset token to user document...');
    user.resetToken = token;
    user.resetTokenExpires = expiresAt;
    await user.save({ validateBeforeSave: false });
    console.log('✅ Reset token saved. Expires at:', expiresAt);

    // 4. Create reset URL
    const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
    console.log('🔗 Reset URL:', resetUrl);

    // 5. Send email using our email service
    console.log('📤 Attempting to send password reset email...');
    try {
      const emailInfo = await sendPasswordResetEmail(user.email, resetUrl);
      console.log('✅ Password reset email sent successfully');
      
      // If in development and using ethereal, log the preview URL
      if (process.env.NODE_ENV === 'development' && !process.env.GOOGLE_CLIENT_ID) {
        const previewUrl = nodemailer.getTestMessageUrl(emailInfo);
        if (previewUrl) {
          console.log('📧 Test email preview URL:', previewUrl);
        }
      }
      
      // Return consistent response whether email exists or not
      return FORGOT_PASSWORD_RESPONSE;
    } catch (error) {
      console.error('❌ Error sending password reset email:', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        response: error.response
      });
      
      // If email sending fails, clear the reset token
      console.log('🔄 Cleaning up reset token due to email sending failure...');
      user.resetToken = undefined;
      user.resetTokenExpires = undefined;
      await user.save({ validateBeforeSave: false });
      
      // Still return success to maintain consistency
      return FORGOT_PASSWORD_RESPONSE;
    }
  } catch (error) {
    console.error('❌ Forgot password error:', {
      error: error.message,
      stack: error.stack,
      code: error.code,
      response: error.response
    });
    // Return the standard response on error as well
    return FORGOT_PASSWORD_RESPONSE;
  } finally {
    console.log('🏁 Forgot password process completed for email:', email);
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
      return { success: false, message: 'The current password you entered is incorrect.' };
    }

    // Check if new password is same as current
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return { success: false, message: 'New password cannot be the same as the current password.' };
    }

    // Update password
    user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await user.save();

    return { success: true, message: 'Password changed successfully.' };
  } catch (error) {
    console.error('Change password error:', error);
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
    console.error('Set password error:', error);
    return { success: false, message: 'An error occurred while setting password.' };
  }
};

export const updateProfile = async (userId: string, updateData: { username?: string; email?: string; avatar?: string }): Promise<AuthResponse> => {
  // Find the user by ID
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Check if email is being updated and if it already exists
  if (updateData.email && updateData.email !== user.email) {
    const emailExists = await User.findOne({ email: updateData.email });
    if (emailExists) {
      throw new Error('Email already in use');
    }
  }

  // Check if username is being updated and if it already exists
  if (updateData.username && updateData.username !== user.username) {
    const usernameExists = await User.findOne({ username: updateData.username });
    if (usernameExists) {
      throw new Error('Username already taken');
    }
  }

  // Update user fields
  if (updateData.username) user.username = updateData.username;
  if (updateData.email) user.email = updateData.email;
  if (updateData.avatar) user.avatar = updateData.avatar;

  // Save the updated user
  const updatedUser = await user.save();
  
  // Generate new token with updated user data
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
    console.error('Error deleting user account:', error);
    throw new Error('Failed to delete account. Please try again later.');
  }
};

export const resetPassword = async (token: string, newPassword: string): Promise<{ success: boolean; message: string }> => {
  try {
    // 1. Find user by reset token and check if token is not expired
    const user = await User.findOne({
      resetToken: token,
      resetTokenExpires: { $gt: new Date() }
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
    user.resetToken = undefined;
    user.resetTokenExpires = undefined;
    
    // This will trigger the pre-save hook to hash the password
    await user.save();

    return { 
      success: true, 
      message: 'Your password has been reset successfully. Please log in with your new password.' 
    };
  } catch (error) {
    console.error('Reset password error:', error);
    return { 
      success: false, 
      message: 'An error occurred while resetting your password. Please try again.' 
    };
  }
}

