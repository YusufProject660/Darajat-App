import { Request, Response } from 'express';
import asyncHandler from '../../../middleware/async';
import User from '../user.model';
import { upload } from '../../../middlewares/upload';
import { updateProfile, formatUserResponse, generateToken } from '../auth.service';
import fs from 'fs-extra';
import path from 'path';

/**
 * @desc    Get user profile
 * @route   GET /api/user/profile
 * @access  Private
 */
/**
 * @desc    Update user profile
 * @route   PUT /api/auth/profile
 * @access  Private
 */
export const updateUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const { firstName, lastName, email } = req.body;
  
  if (!req.user?._id) {
    return res.status(401).json({
      status: 0,
      message: 'Not authorized',
      error: 'UNAUTHORIZED'
    });
  }

  try {
    const updatedUser = await updateProfile(req.user._id.toString(), {
      firstName,
      lastName,
      email
    });

    // Generate new token with updated user data
    const token = generateToken(updatedUser);
    const userResponse = formatUserResponse(updatedUser, token);
    
    return res.status(200).json({
      status: 1,
      message: 'Profile updated successfully',
      data: {
        userId: userResponse.id,
        email: userResponse.email,
        firstName: userResponse.firstName || '',
        lastName: userResponse.lastName || '',
        role: userResponse.role || 'user',
        stats: userResponse.stats
      }
    });
  } catch (error: any) {
    return res.status(400).json({
      status: 0,
      message: error.message || 'Failed to update profile',
      error: error.code || 'UPDATE_PROFILE_FAILED'
    });
  }
});

/**
 * @desc    Get user profile
 * @route   GET /api/auth/profile
 * @access  Private
 */
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  // Get user from the token (added by protect middleware)
  const user = await User.findById(req.user?._id).select('-password -resetToken -resetTokenExpires -__v');

  if (!user) {
    return res.status(200).json({
      status: 0,
      message: 'User not found',
      error: 'USER_NOT_FOUND'
    });
  }

  // Format the response with all stats fields
  const userProfile = {
    userId: user._id,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    email: user.email,
    avatar : user.avatar || null,
    stats: {
      gamesPlayed: user.stats?.gamesPlayed ?? 0,
      accuracy: user.stats?.accuracy ?? 0,
      bestScore: user.stats?.bestScore ?? 0
    }
  };

  return res.status(200).json({
    status: 1,
    message: 'User profile fetched successfully',
    data: userProfile
  });
});
/**
 * @desc    Upload/Update profile picture
 * @route   PUT /api/user/profile-picture
 * @access  Private
 */
// In src/modules/users/controllers/profile.controller.ts
export const updateProfilePicture = asyncHandler(async (req: any, res: Response) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(200).json({
        status: 0,
        message: 'Please upload an image file.'
      });
    }

    // Get user from database
    const user = await User.findById(req.user._id);
    if (!user) {
      // Clean up the uploaded file if user not found
      await fs.unlink(req.file.path);
      return res.status(200).json({
        status: 0,
        message: 'User not found.'
      });
    }

    // Delete previous avatar if it exists
    if (user.avatar) {
      const oldAvatarPath = path.join(__dirname, '../../../', user.avatar);
      if (await fs.pathExists(oldAvatarPath)) {
        await fs.unlink(oldAvatarPath);
      }
    }

    // Update user's avatar path (relative to the server root)
    const relativePath = path.relative(
      path.join(__dirname, '../../../'),
      req.file.path
    ).replace(/\\/g, '/'); // Convert Windows paths to forward slashes

    user.avatar = `/${relativePath}`;
    await user.save();

    return res.status(200).json({
      status: 1,
      message: 'Profile picture updated successfully.',
      data: {
        imageUrl: `/${relativePath}`
      }
    });

  } catch (error: any) {
    // Clean up the uploaded file if there was an error
    if (req.file && (await fs.pathExists(req.file.path))) {
      await fs.unlink(req.file.path);
    }
    return res.status(200).json({
      status: 0,
      message: error.message || 'Image upload failed. Please try again later.'
    });
  }
});