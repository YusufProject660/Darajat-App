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
  return jwt.sign(
    { 
      id: user._id,
      role: user.role 
    }, 
    config.jwtSecret, 
    { expiresIn: '7d' }
  );
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

export const register = async (username: string, email: string, password: string): Promise<AuthResponse> => {
  // Check if user exists
  const userExists = await User.findOne({ $or: [{ email }, { username }] });
  if (userExists) {
    throw new Error('User with this email or username already exists');
  }

  // Hash password before saving
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  
  // Create user with hashed password and default stats
  const user = await User.create({
    username,
    email,
    password: hashedPassword,
    role: 'player',
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

  // Secure password comparison using bcrypt
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    const error = new Error('Invalid email or password') as any;
    error.statusCode = 401;
    error.code = 'INVALID_CREDENTIALS';
    throw error;
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
      // Create new user with Google auth and plain text password
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
      password: 'google_oauth_user' // Simple password for Google auth users
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
  try {
    // 1. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      // Return success to prevent email enumeration
      return FORGOT_PASSWORD_RESPONSE;
    }

    // 2. Generate reset token
    const { token, expiresAt } = generateResetToken();
    
    // 3. Save the reset token and expiry to the user document
    user.resetToken = token;
    user.resetTokenExpires = expiresAt;
    await user.save({ validateBeforeSave: false });

    // 4. Create reset URL
    const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
    
    // 5. Create email message
    const message = `You requested a password reset. Please click the following link to reset your password: \n\n${resetUrl}\n\nThis link will expire in 15 minutes.\n\nIf you didn't request this, please ignore this email.`;

    // 6. Send email using our email service
    try {
      await sendPasswordResetEmail(user.email, resetUrl);
      
      // Return consistent response whether email exists or not
      return FORGOT_PASSWORD_RESPONSE;
    } catch (error) {
      // If email sending fails, clear the reset token
      user.resetToken = undefined;
      user.resetTokenExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error('Error sending email:', error);
      // Still return success to maintain consistency
      return FORGOT_PASSWORD_RESPONSE;
    }
  } catch (error) {
    console.error('Forgot password error:', error);
    // Return the standard response on error as well
    return FORGOT_PASSWORD_RESPONSE;
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
    // Hash new password before saving
  user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await user.save();

    return { success: true, message: 'Password changed successfully.' };
  } catch (error) {
    console.error('Change password error:', error);
    return { success: false, message: 'An error occurred while changing password.' };
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
    // Hash new password before saving
  user.password = await bcrypt.hash(newPassword, SALT_ROUNDS);
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

