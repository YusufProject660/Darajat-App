import { Request, Response } from "express";
import User from "../modules/users/user.model";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN, GOOGLE_CLIENT_ID } from "../config";
import { sendEmail } from "../config/email";
// import { OAuth2Client } from "google-auth-library";
import * as validator from 'validator';

// const client = new OAuth2Client(GOOGLE_CLIENT_ID);

import { Types } from 'mongoose';

interface IUserPayload {
  _id: Types.ObjectId;
  email: string;
}

const signToken = (user: IUserPayload) => {
  return jwt.sign(
    { 
      user_id: user._id, // Changed from id to user_id
      email: user.email 
    }, 
    JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    }
  );
};

// Helper function to validate email format
const isValidEmail = (email: string): { isValid: boolean; message?: string } => {
  // Check if email is provided
  if (!email || typeof email !== 'string') {
    return { 
      isValid: false, 
      message: 'Email is required and must be a string' 
    };
  }
  
  // Trim and sanitize email
  email = email.trim().toLowerCase();
  
  // Check for basic email format with strict character restrictions
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return {
      isValid: false,
      message: 'Invalid email format. Only letters, numbers, dots, underscores, percentages, plus signs, and hyphens are allowed before the @ symbol.'
    };
  }
  
  // Check for consecutive dots
  if (email.includes('..')) {
    return {
      isValid: false,
      message: 'Email cannot contain consecutive dots'
    };
  }
  
  // Split into local and domain parts
  const [localPart, domainPart] = email.split('@');
  
  // Validate domain part
  if (!domainPart.includes('.') || domainPart.split('.').some(part => part.length === 0)) {
    return {
      isValid: false,
      message: 'Invalid domain format'
    };
  }
  
  // Additional validation using validator
 
if (!validator.default.isEmail(email)) {
    return {
      isValid: false,
      message: 'Invalid email format'
    };
  }
  
  return { isValid: true };
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, username } = req.body;
    
    // Validate email format
    const emailValidation = isValidEmail(email);
    if (!emailValidation.isValid) {
      return res.status(200).json({
        status: 0,
        message: emailValidation.message || 'Please provide a valid email address'
      });
    }
    
    // Check password length
    if (password && password.length > 20) {
      return res.status(200).json({
        status: 0,
        message: 'Password must be less than or equal to 20 characters.'
      });
    }
    
    // Check if user already exists
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(200).json({
        status: 0,
        message: 'Email already in use'
      });
    }
    
    // Create user with hashed password
    const user = await User.create({ 
      email, 
      password, // The pre-save hook will handle hashing
      username,
      authProvider: 'email',
      hasPassword: true,
      stats: {
        gamesPlayed: 0,
        accuracy: 0,
        bestScore: 0
      },
      role: 'player'
    });
    
    const token = signToken({
      _id: user._id,
      email: user.email
    });
    
    const { _id, ...userData } = user.toObject();
    return res.status(200).json({
      status: 1,
      message: 'Signup successful',
      data: { 
        user_id: _id,
        email: user.email,
        role: user.role,
        token
      }
    });
    
  } catch (error: any) {
    console.error('Registration error:', error);
    return res.status(200).json({
      status: 0,
      message: error.message || 'Registration failed. Please try again.'
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.matchPassword(password)))
      return res.status(200).json({
        status: 0,
        message: 'Invalid email or password'
      });
      
    const token = signToken({
      _id: user._id,
      email: user.email
    });
    const { _id, ...userData } = user.toObject();
    return res.status(200).json({
      status: 1,
      message: 'Login successful',
      data: { 
        token, 
        user: {
          user_id: _id,
          ...userData
        }
      }
    });
  } catch (error: any) {
    console.error('Login error:', error);
    return res.status(200).json({
      status: 0,
      message: error.message || 'Login failed. Please try again.'
    });
  }
};

// export const googleLogin = async (req: Request, res: Response) => {
//   const { idToken } = req.body;
// //   console.log(idToken);
//   const ticket = await client.verifyIdToken({
//     idToken,
//     audience: GOOGLE_CLIENT_ID,
//   });
//   const payload = ticket.getPayload();
//   if (!payload || !payload.email)
//     return res.apiError("Invalid Google token", "INVALID_GOOGLE_TOKEN");
//   let user = await User.findOne({ email: payload.email });
//   if (!user) {
//     user = await User.create({
//       email: payload.email,

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(200).json({
      status: 0,
      message: 'Email is required'
    });
  }

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(200).json({
      status: 0,
      message: 'No account found with this email'
    });
  }

  const resetToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '100y' });
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const html = `
    <p>Hello ${user.username},</p>
    <p>You requested a password reset. Click the link below to reset your password:</p>
    <a href="${resetUrl}">Reset Password</a>
    <p>This link will expire in 1 hour.</p>
  `;

  try {
    await sendEmail(user.email, 'DaRajat App - Password Reset Request', html);
    return res.status(200).json({
      status: 1,
      message: 'Password reset email sent',
      data: {}
    });
  } catch (err) {
    console.error(err);
    return res.status(200).json({
      status: 0,
      message: 'Failed to send password reset email',
      code: 'EMAIL_SEND_ERROR'
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.apiSuccess({ token }, 'Google authentication successful');

  try {
    const payload: any = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.apiError('User not found', 'USER_NOT_FOUND');

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    return res.apiSuccess({}, 'Password has been reset successfully');
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.apiError('Password reset token has expired', 'TOKEN_EXPIRED');
    }
    if (err.name === 'JsonWebTokenError') {
      return res.apiError('Invalid token', 'INVALID_TOKEN');
    }
    return res.apiError('Failed to reset password', 'PASSWORD_RESET_ERROR');
  }
};
