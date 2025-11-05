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
    return res.status(200).json({
      status: 0,
      message: 'User not found',
      error: 'USER_NOT_FOUND'
    });
  }

  // Format the response with all stats fields
  const userProfile = {
    userId: user._id,
    fullName: user.username, // Using username as fullName
    email: user.email,
    username: user.username,
    avatarUrl: user.avatar || '',
    stats: {
      // Existing fields (maintaining backward compatibility)
      gamesPlayed: user.stats?.gamesPlayed ?? 0,
      accuracy: user.stats?.accuracy ?? 0,
      bestScore: user.stats?.bestScore ?? 0,
      // New fields
      totalCorrectAnswers: user.stats?.totalCorrectAnswers ?? 0,
      totalQuestionsAnswered: user.stats?.totalQuestionsAnswered ?? 0,
      totalTimePlayed: user.stats?.totalTimePlayed ?? 0
    }
  };

  return res.status(200).json({
    status: 1,
    message: 'User profile fetched successfully',
    data: userProfile
  });
});
