import { config } from '../../config/env';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User, { IUser } from './user.model';
import { sendPasswordResetEmail } from '../../config/email';

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

  // Create user with default stats
  const user = await User.create({
    username,
    email,
    password,
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

  // Check if password matches (plain text comparison)
  const isMatch = user.matchPassword(password);
  if (!isMatch) {
    const error = new Error('Invalid password') as any;
    error.statusCode = 401;
    error.code = 'INVALID_PASSWORD';
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
    // Generate a random password in plain text for Google auth
    const plainTextPassword = crypto.randomBytes(20).toString('hex');
    
    // Create new user if doesn't exist
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
      password: plainTextPassword
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

