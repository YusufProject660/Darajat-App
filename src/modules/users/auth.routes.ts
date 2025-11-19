import { Router, Request, Response } from 'express';
import passport from 'passport';
import { 
  registerUser, 
  loginUser, 
  getMeHandler, 
  isAdmin,
  googleCallback,
  googleAuthSuccess,
  googleAuthFailure,
  resetPasswordHandler,
  resetPasswordPage,
  changePassword,
  updateUserProfile,
  deleteUserAccount,
  logoutUser,
  saveFirebaseUserHandler
} from './auth.controller';
import { forgotPassword as forgotPasswordService } from './auth.service';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/role.middleware';
import { logger } from '../../utils/logger';
import { updateProfilePicture } from './controllers/profile.controller';
import { upload } from '../../middlewares/upload';

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

// Firebase user route
router.all('/firebase-google', (req, res, next) => {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 0,
      message: 'Invalid request method. Use POST.'
    });
  }
  return saveFirebaseUserHandler(req, res, next);
});
router.all('/login', (req, res, next) => {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 0,
      message: `Method ${req.method} not allowed. Use POST instead.`
    });
  }
  return loginUser(req, res, next);
});

// Logout route
router.all('/logout', (req, res, next) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(200).json({
      status: 0,
      message: 'Method not allowed. Please use POST method for this endpoint.'
    });
    return;
  }
  next();
  return;
});
router.post('/logout', logoutUser);

// Password reset routes
router.get('/reset-password', resetPasswordPage as any);

// Handle the reset password form submission
router.post('/reset-password', resetPasswordHandler as any);

// Helper function to create a timeout promise
const createTimeout = <T>(ms: number, message: string): Promise<T> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
};

// Forgot password route with timeout handling
const handleForgotPassword = async (req: Request, res: Response) => {
  const ROUTE_TIMEOUT = 30000; // 30 seconds
  const logPrefix = '🔵 [FORGOT_PASSWORD_ROUTE]';
  
  logger.info(`${logPrefix} [START] Processing forgot password request`);
  
  // Set a timeout for the entire request
  const timeoutPromise = createTimeout<never>(
    ROUTE_TIMEOUT,
    'Request timeout. The server is taking too long to respond.'
  );

  try {
    const { email } = req.body;
    
    // Validate email presence
    if (!email) {
      logger.warn(`${logPrefix} [ERROR] Email is required`);
      return res.status(200).json({
        status: 0,
        message: 'Email is required.',
        code: 'EMAIL_REQUIRED'
      });
    }

    // Normalize the email
    const normalizedEmail = email.trim().toLowerCase();
    logger.info(`${logPrefix} [PROCESSING] Processing request for email:`, normalizedEmail);

    // Call the forgotPassword service with timeout
    const result = await Promise.race([
      forgotPasswordService(normalizedEmail),
      timeoutPromise
    ]);

    logger.info(`${logPrefix} [SUCCESS] Password reset processed for:`, normalizedEmail);
    return res.status(200).json(result);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`${logPrefix} [ERROR]`, error);
    
    if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
      return res.status(200).json({
        status: 0,
        message: 'Request timeout. The server is taking too long to respond.',
        code: 'REQUEST_TIMEOUT'
      });
    }
    
    return res.status(200).json({
      status: 0,
      message: 'An error occurred while processing your request. Please try again later.',
      code: 'INTERNAL_ERROR'
    });
  } finally {
    logger.debug(`${logPrefix} [END] Request processing completed`);
  }
};

// Forgot password routes
router.post('/forgot-password', handleForgotPassword);


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
  googleCallback as any
);

router.get('/google/success', googleAuthSuccess as any);
router.get('/google/failure', googleAuthFailure as any);

// Profile routes - Method validation before authentication
router.all('/profile', (req, res, next) => {
  if (req.method !== 'PATCH') {
    res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use PATCH for this endpoint.'
    });
    return;
  }
  next();
  return;
});

// General authenticated routes - available to all authenticated users


router.get('/me', protect, getMeHandler);


router.all('/me', (req, res, next) => {
  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    res.status(200).json({
      status: 0,
      message: 'Method not allowed. Please use GET for this endpoint.'
    });
    return;
  }
  next();
});

router.patch('/profile', protect, updateUserProfile);
router.all('/profile', (req, res, next) => {
  if (req.method !== 'PATCH') {
    res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use PATCH for this endpoint.'
    });
    return;
  }
  next();
});

// Profile picture update route - Method validation before authentication
router.all('/profile-picture', (req, res, next) => {
  if (req.method !== 'PUT') {
    res.set('Allow', 'PUT');
    res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use PUT for this endpoint.'
    });
    return;
  }
  next();
  return;
});
router.put('/profile-picture', protect, upload.single('profilePicture'), updateProfilePicture);

router.delete('/delete', protect, deleteUserAccount);
router.all('/delete', (req, res, next) => {
  if (req.method !== 'DELETE') {
    res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use DELETE for this endpoint.'
    });
    return;
  }
  next();
  return;
});

// Change password route with method validation
router.all('/change-password', (req, res, next) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    res.status(200).json({
      status: 0,
      message: `Invalid request method. Please use POST for this endpoint.`
    });
    return;
  }
  next();
  return;
}, protect, changePassword);

// Admin routes (require admin role) - must be last to not affect other routes
router.get('/admin', authorize('admin'), isAdmin);
router.use(protect);
export default router;
