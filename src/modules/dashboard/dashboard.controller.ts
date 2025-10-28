import { Request, Response } from 'express';
import { Dashboard } from './dashboard.model';
import { DashboardGame } from './models/dashboard-game.model';

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
}

export const getDashboardData = async (_req: Request, res: Response): Promise<void> => {
  try {
    // Fetch dashboard data
    const dashboardData = await Dashboard.findOne({}).lean<IDashboardData>();
    
    if (!dashboardData) {
      res.status(404).json({
        success: false,
        message: 'Dashboard configuration not found'
      });
      return;
    }

    // Fetch games data
    const games = await DashboardGame.find(
      {},
      { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 }
    ).lean();

    // Prepare response
    const response = {
      success: true,
      message: 'Dashboard data fetched successfully',
      data: {
        banner: dashboardData.banner,
        funGames: games,
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
