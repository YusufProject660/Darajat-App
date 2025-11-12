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
  resetPasswordPage,
  changePassword,
  updateUserProfile,
  deleteUserAccount
} from './auth.controller';
import { verifyToken } from '../../middleware/auth.middleware';
// Alias verifyToken as protect for backward compatibility
const protect = verifyToken;
import { authorize } from '../../middlewares/role.middleware';

const router = Router();
// const validateMethod = (allowedMethod: string, handler: any) => {
//   return (req: any, res: any, next: any) => {
//     if (req.method !== allowedMethod) {
//       res.set('Allow', allowedMethod);
//       return res.status(200).json({
//         status: 0,
//         message: `Method not allowed. Please use ${allowedMethod} for this endpoint.`
//       });
//     }
//     return handler(req, res, next);
//   };
// }

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
router.post('/logout', verifyToken, logoutUser);

// Password reset routes
router.get('/reset-password', (req, res, next) => {
  console.log('GET /reset-password route hit');
  return resetPasswordPage(req, res, next);
});

// Handle the reset password form submission
router.post('/reset-password', (req, res, next) => {
  console.log('POST /reset-password route hit');
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
  const ROUTE_TIMEOUT = 20000000; // 30 seconds
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
      forgotPassword(normalizedEmail),
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
// router.post('/forgot-password', handleForgotPassword);
router.post('/api/auth/forgot-password', handleForgotPassword);

// API endpoint for reset password (for programmatic access if needed)
router.post('/api/auth/reset-password', (req, res, next) => {
  console.log('POST /api/auth/reset-password route hit');
  return resetPasswordHandler(req, res, next);
});

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
router.all('/me', (req, res, next) => {
  if (req.method !== 'GET') {
    res.set('Allow', 'GET');
    return res.status(200).json({
      status: 0,
      message: 'Method not allowed. Please use GET for this endpoint.'
    });
  }
  next();
}, verifyToken, getMeHandler);

router.get('/logout', verifyToken, logoutUser);
router.patch('/profile', verifyToken, updateUserProfile);

// Delete account route with method validation
router.all('/delete', (req, res, next) => {
  if (req.method !== 'DELETE') {
    return res.status(200).json({
      status: 0,
      message: 'Invalid request method. Please use DELETE for this endpoint.'
    });
  }
  next();
});
router.delete('/delete', deleteUserAccount);

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
}, verifyToken, changePassword);

// Admin routes (require admin role) - must be last to not affect other routes
router.get('/admin', authorize('admin'), isAdmin);
router.use(verifyToken);
export default router;
