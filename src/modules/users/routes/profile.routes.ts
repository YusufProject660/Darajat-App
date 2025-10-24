import { Router } from 'express';
import { protect } from '../../../middlewares/auth.middleware';
import { getUserProfile } from '../controllers/profile.controller';

const router = Router();

// Apply authentication middleware to all routes
router.use(protect);

/**
 * @route   GET /api/user/profile
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile', getUserProfile);

export default router;
