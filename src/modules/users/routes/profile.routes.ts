import { Router } from 'express';
import { protect } from '../../../middlewares/auth.middleware';
import { getUserProfile, updateProfilePicture } from '../controllers/profile.controller';
import { upload } from '../../../middlewares/upload';

const router = Router();

// Method validation middleware for GET requests
const validateGetMethod = (req: any, res: any, next: any) => {
  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    return res.status(405).json({
      status: 0,
      message: 'Method not allowed. Please use GET for this endpoint.'
    });
  }
  next();
};

// Method validation middleware for PUT requests
const validatePutMethod = (req: any, res: any, next: any) => {
  if (req.method !== 'PUT') {
    res.set('Allow', 'PUT');
    return res.status(405).json({
      status: 0,
      message: 'Method not allowed. Please use PUT for this endpoint.'
    });
  }
  next();
};

// GET /profile - Get user profile
router.route('/profile')
  .get(validateGetMethod, protect, getUserProfile);

// PUT /profile-picture - Upload profile picture 
router.route('/profile-picture')
  .put(validatePutMethod, protect, upload.single('profilePicture'), updateProfilePicture);

export default router;
