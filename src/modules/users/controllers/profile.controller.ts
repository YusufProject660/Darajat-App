import { Request, Response } from 'express';
import asyncHandler from '../../../middleware/async';
import User from '../user.model';

/**
 * @desc    Get user profile
 * @route   GET /api/user/profile
 * @access  Private
 */
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  // Get user from the token (added by protect middleware)
  const user = await User.findById(req.user?._id).select('-password -resetToken -resetTokenExpires -__v');

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  // Format the response
  const userProfile = {
    userId: user._id,
    fullName: user.username, // Using username as fullName
    email: user.email,
    username: user.username,
    avatarUrl: user.avatar || '',
    stats: {
      gamesPlayed: user.stats?.gamesPlayed || 0,
      accuracy: user.stats?.accuracy || 0,
      bestScore: user.stats?.bestScore || 0
    }
  };

  return res.status(200).json({
    success: true,
    message: 'User profile fetched successfully',
    data: userProfile
  });
});
