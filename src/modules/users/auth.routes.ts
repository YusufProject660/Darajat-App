import { Router } from 'express';
import passport from 'passport';
import { 
  registerUser, 
  loginUser, 
  getMeHandler, 
  logoutUser,
  isAdmin,
  googleCallback,
  googleAuthSuccess,
  googleAuthFailure,
  requestPasswordReset,
  resetPasswordHandler,
  changePassword,
  updateUserProfile,
  deleteUserAccount
} from './auth.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/role.middleware';

const router = Router();

// Public routes
router.all('/signup', (req, res, next) => {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 0,
      message: 'Invalid request method. Use POST.'
    });
  }
  return registerUser(req, res, next);
});
router.post('/login', loginUser);
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPasswordHandler);

// Google OAuth routes
router.get('/google', 
  passport.authenticate('google', { 
    scope: ['profile', 'email'] 
  })
);

router.get('/google/callback', 
  passport.authenticate('google', { 
    failureRedirect: '/api/auth/google/failure',
    session: false 
  }),
  googleCallback
);

router.get('/google/success', googleAuthSuccess);
router.get('/google/failure', googleAuthFailure);

// Protected routes (require authentication)
router.use(protect);

// General authenticated routes - available to all authenticated users
router.get('/me', getMeHandler);
router.get('/logout', logoutUser);

// Profile routes
router.patch('/profile', updateUserProfile);
router.delete('/delete', deleteUserAccount);

// Change password route - explicitly allow both player and admin roles
router.post('/change-password', (req, _, next) => {
  try {
    console.log('=== CHANGE PASSWORD ROUTE ===');
    console.log('Request Headers:', req.headers);
    console.log('Request Body:', req.body);
    console.log('Request User:', req.user);
    console.log('Request User Role:', req.user?.role);
    next();
    return; // Explicit return to satisfy linter
  } catch (error) {
    next(error);
  }
}, changePassword);

// Admin routes (require admin role) - must be last to not affect other routes
router.get('/admin', authorize('admin'), isAdmin);

export default router;
