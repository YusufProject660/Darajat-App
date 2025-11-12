import { Router } from 'express';
import { getDashboardData } from './dashboard.controller';
import { protect } from '../../middlewares/auth.middleware';

const router = Router();

/**
 * @route   GET /api/dashboard
 * @desc    Get dashboard data (banner, games, actions)
 * @access  Private (JWT required)
 */
router.route('/')
  .get(protect, getDashboardData)
  .all((_req, res) => {
    res.status(405).json({
      status: 0,
      message: 'Method not allowed. Use GET for this endpoint.'
    });
  });

export default router;
