import { Router } from 'express';
import { getDashboardData } from './dashboard.controller';
import { protect } from '../../middlewares/auth.middleware';

const router = Router();

/**
 * @route   GET /api/dashboard
 * @desc    Get dashboard data (banner, games, actions)
 * @access  Private (JWT required)
 */
router.get('/', protect, getDashboardData);

export default router;
