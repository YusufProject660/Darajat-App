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
  resetPasswordHandler
} from './auth.controller';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/role.middleware';

const router = Router();

// Public routes
router.post('/signup', registerUser);
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

router.get('/me', getMeHandler);
router.get('/logout', logoutUser);

// Admin routes (require admin role)
router.use(authorize('admin'));
router.get('/admin', isAdmin);

export default router;
