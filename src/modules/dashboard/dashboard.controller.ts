import { Request, Response } from 'express';
import { Dashboard } from './dashboard.model';
import { logger } from '../../utils/logger';
import path from 'path';
import fs from 'fs';

interface IDashboardData {
  banner: {
    title: string;
    description: string;
    createButtonText: string;
    image: string;
  };
  actions: {
    joinGameText: string;
    howToPlayLink: string;
  };
  funGames: Array<{
    id: string;
    title: string;
    description: string;
    image: string;
    status: 'available' | 'coming_soon' | 'maintenance';
  }>;
}

/**
 * @desc    Get dashboard data (banner, games, actions)
 * @route   GET /api/dashboard
 * @access  Private (JWT required)
 */
export const getDashboardData = async (req: Request, res: Response): Promise<void> => {
  try {
    // Fetch dashboard data with embedded games
    const dashboardData = await Dashboard.findOne({})
      .select('banner actions funGames')
      .lean<IDashboardData>();
    
    if (!dashboardData) {
      res.apiError('Dashboard configuration not found.', 'DASHBOARD_NOT_FOUND');
      return;
    }

    // Prepare user object with required fields
    const user = req.user ? {
      first_name: req.user.firstName || '',
      last_name: req.user.lastName || '',
      email: req.user.email || '',
      profile_picture: req.user.avatar || null
    } : null;

    // Map game images: Use local image if exists, otherwise use database URL
    const formattedGames = (dashboardData.funGames || []).map(game => {
      // Check if local image exists in uploads/games-image folder
      const localImagePath = path.join(process.cwd(), 'uploads', 'games-image', `${game.id}.png`);
      const localImageExists = fs.existsSync(localImagePath);
      
      // If local image exists, use it; otherwise use the original database image URL
      const imageUrl = localImageExists 
        ? `/uploads/games-image/${game.id}.png`
        : game.image; // Use original database image URL
      
      return {
        ...game,
        image: imageUrl
      };
    });

    // Prepare and send success response with funGames and user
    res.apiSuccess({
      user,
      funGames: formattedGames
    }, 'Dashboard data fetched successfully');
  } catch (error) {
    logger.error('Error fetching dashboard data:', error);
    res.apiError('Unable to fetch dashboard data at the moment. Please try again later.', 'DASHBOARD_FETCH_ERROR');
  }
};
