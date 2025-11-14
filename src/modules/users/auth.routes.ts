import { Router, Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { 
  registerUser, 
  loginUser, 
  getMeHandler, 
  isAdmin,
  googleCallback,
  googleAuthSuccess,
  googleAuthFailure,
  requestPasswordReset,
  resetPasswordHandler,
  resetPasswordPage,
  changePassword,
  updateUserProfile,
  deleteUserAccount,
  logoutUser
} from './auth.controller';
import { forgotPassword as forgotPasswordService } from './auth.service';
import { protect } from '../../middlewares/auth.middleware';
import { authorize } from '../../middlewares/role.middleware';

const router = Router();
/**
 * Middleware factory function that enforces a specific HTTP method for a route.
 * If the request method doesn't match the allowed method, it returns a 200 status
 * with an error message indicating the allowed method.
 * 
 * @param {string} allowedMethod - The HTTP method that is allowed (e.g., 'GET', 'POST')
 * @param {Function} handler - The route handler function to execute if the method matches
 * @returns {Function} A middleware function that validates the HTTP method before proceeding
 */
const validateMethod = (allowedMethod: string, handler: any) => {
  return (req: any, res: any, next: any) => {
    if (req.method !== allowedMethod) {
      // Set the Allow header to indicate allowed methods
      res.set('Allow', allowedMethod);
      return res.status(200).json({
        status: 0,
        message: `Method not allowed. Please use ${allowedMethod} for this endpoint.`
      });
    }
    // Proceed to the route handler if the method matches
    return handler(req, res, next);
  };
}

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
    return res.status(200).json({
      status: 0,
      message: 'Method not allowed. Please use POST method for this endpoint.'
    });
  }
  next();
});
router.post('/logout', logoutUser);

// Password reset routes
router.get('/api/auth/reset-password', (req, res, next) => {
  console.log('GET /api/auth/reset-password route hit');
  return resetPasswordPage(req, res, next);
});

// Handle the reset password form submission
router.post('/api/auth/reset-password', (req, res, next) => {
  console.log('POST /api/auth/reset-password route hit');
  return resetPasswordHandler(req, res, next);
});

// Helper function to create a timeout promise
const createTimeout = <T>(ms: number, message: string): Promise<T> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
};

// Forgot password route with timeout handling
const handleForgotPassword = async (req: Request, res: Response, next: NextFunction) => {
  const ROUTE_TIMEOUT = 30000; // 30 seconds
  const logPrefix = '🔵 [FORGOT_PASSWORD_ROUTE]';
  
  console.log(`${logPrefix} [START] Processing forgot password request`);
  
  // Set a timeout for the entire request
  const timeoutPromise = createTimeout<never>(
    ROUTE_TIMEOUT,
    'Request timeout. The server is taking too long to respond.'
  );

  try {
    const { email } = req.body;
    
    // Validate email presence
    if (!email) {
      console.log(`${logPrefix} [ERROR] Email is required`);
      return res.status(200).json({
        status: 0,
        message: 'Email is required.',
        code: 'EMAIL_REQUIRED'
      });
    }

    // Normalize the email
    const normalizedEmail = email.trim().toLowerCase();
    console.log(`${logPrefix} [PROCESSING] Processing request for email:`, normalizedEmail);

    // Call the forgotPassword service with timeout
    const result = await Promise.race([
      forgotPasswordService(normalizedEmail),
      timeoutPromise
    ]);

    console.log(`${logPrefix} [SUCCESS] Password reset processed for:`, normalizedEmail);
    return res.status(200).json(result);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${logPrefix} [ERROR]`, error);
    
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
    console.log(`${logPrefix} [END] Request processing completed`);
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
  googleCallback
);

router.get('/google/success', googleAuthSuccess);
router.get('/google/failure', googleAuthFailure);

// Profile routes - Method validation before authentication
router.all('/profile', (req, res, next) => {
  if (req.method !== 'PATCH') {
    return res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use PATCH for this endpoint.'
    });
  }
  next();
});

// General authenticated routes - available to all authenticated users


router.get('/me', protect, getMeHandler);


router.all('/me', (req, res) => {
  res.set('Allow', 'GET');
  return res.status(200).json({
    status: 0,
    message: 'Method not allowed. Please use GET for this endpoint.'
  });
});

router.patch('/profile', protect, updateUserProfile);
router.all('/profile', (req, res) => {
  return res.status(200).json({
    status: 0,
    message: 'Invalid request method. Please use PATCH for this endpoint.'
  });
});

router.delete('/delete', protect, deleteUserAccount);
router.all('/delete', (req, res) => {
  return res.status(200).json({
    status: 0,
    message: 'Invalid request method. Please use DELETE for this endpoint.'
  });
});

// Change password route with method validation
router.all('/change-password', (req, res, next) => {
  if (req.method !== 'POST') {
    res.set('Allow', 'POST');
    return res.status(200).json({
      status: 0,
      message: `Invalid request method. Please use POST for this endpoint.`
    });
  }
  next();
}, protect, changePassword);

// Admin routes (require admin role) - must be last to not affect other routes
router.get('/admin', authorize('admin'), isAdmin);
router.use(protect);
export default router;
