import { Request, Response } from 'express';
import { Dashboard } from './dashboard.model';
import { logger } from '../../utils/logger';

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
export const getDashboardData = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Fetch dashboard data with embedded games
    const dashboardData = await Dashboard.findOne({})
      .select('banner actions funGames')
      .lean<IDashboardData>();
    
    if (!dashboardData) {
      res.apiError('Dashboard configuration not found.', 'DASHBOARD_NOT_FOUND');
      return;
    }

    // Prepare and send success response with only funGames
    res.apiSuccess({
      funGames: dashboardData.funGames || []
    }, 'Dashboard data fetched successfully');
  } catch (error) {
    logger.error('Error fetching dashboard data:', error);
    res.apiError('Unable to fetch dashboard data at the moment. Please try again later.', 'DASHBOARD_FETCH_ERROR');
  }
};
