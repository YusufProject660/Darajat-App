import { Request, Response } from 'express';
import { Dashboard } from './dashboard.model';

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
      res.status(404).json({
        success: false,
        message: 'Dashboard configuration not found.'
      });
      return;
    }

    // Prepare response
    const response = {
      success: true,
      message: 'Dashboard data fetched successfully',
      data: {
        banner: dashboardData.banner,
        funGames: dashboardData.funGames || [],
        actions: dashboardData.actions
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    res.status(500).json({
      success: false,
      message: 'Unable to fetch dashboard data at the moment. Please try again later.'
    });
  }
};
