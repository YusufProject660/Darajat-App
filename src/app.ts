import express, { Application, Request, Response } from 'express';
import http from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';
import xss from 'xss-clean';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import session from 'express-session';
import morgan from 'morgan';
import passport from 'passport';
import { Server as SocketIOServer } from 'socket.io';
// mongoose import removed as it was unused
import { config } from './config/env';
import { connectDB } from './config/db';
import authRoutes from './modules/users/auth.routes';
import profileRoutes from './modules/users/routes/profile.routes';
import gameRoutes from './modules/games/game.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import { initializeSocket } from './modules/games/services/socket.service';
import { globalErrorHandler, notFoundHandler } from './middlewares/error.middleware';
import { createError } from './utils/appError';
import 'express-async-errors';
import './config/passport';
import { logger, stream } from './utils/logger';

export class App {
  public app: Application;
  public server: http.Server;
  public io?: SocketIOServer;
  private port: string | number;
  private isInitialized = false;
  private isTestEnv = process.env.NODE_ENV === 'test';

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.port = config.port || 5000;
    
    // Initialize middlewares
    this.initializeMiddlewares();
    
    // Initialize routes
    this.initializeRoutes();
    
    // Initialize error handling
    this.initializeErrorHandling();
  }

  // Start the HTTP server
  private start(): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        reject(new Error('Server not initialized'));
        return;
      }

      const errorHandler = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`❌ Port ${this.port} is already in use`);
        } else {
          console.error('❌ Server error:', error);
        }
        reject(error);
        this.server?.removeListener('error', errorHandler);
      };

      this.server.on('error', errorHandler);

      // Start listening
      this.server.listen(this.port, () => {
        if (!this.isTestEnv) {
          console.log(`🚀 Server running on http://localhost:${this.port}`);
        }
        this.server?.removeListener('error', errorHandler);
        resolve(this.server);
      });
    });
  }

  public async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  App is already initialized');
      return this.server;
    }

    try {
      logger.info('🔌 Initializing database connection...');
      await connectDB();
      
      // Start the HTTP server first
      logger.info('🚀 Starting HTTP server...');
      await this.start();
      
      // Then initialize WebSocket after the server is running
      logger.info('🔌 Initializing WebSocket...');
      this.initializeSocketIO();
      
      this.isInitialized = true;
      logger.info(`✅ Application running in ${config.nodeEnv} mode on port ${this.port}`);
      return this.server;
    } catch (error) {
      logger.error('❌ Failed to initialize application:', error);
      process.exit(1);
    }
  }
  
  private initializeMiddlewares() {
    // Request logging with Winston
    this.app.use(morgan('combined', { stream }));

    // Define allowed origins
    const allowedOrigins = [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://localhost:3000',
      'http://localhost:5173',
      config.clientUrl
    ].filter(Boolean) as string[];

    // Configure CORS with proper type safety
    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        const error = new Error(`Origin ${origin} not allowed by CORS`);
        logger.warn(error.message);
        return callback(error, false);
      },
      credentials: true,
      optionsSuccessStatus: 200, // Some legacy browsers choke on 204
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    };

    // Enable CORS with the configured options
    this.app.use(cors(corsOptions));

    // If requests come through a proxy (e.g., live-server, nginx), trust it so req.ip is correct
    // This prevents express-rate-limit from throwing when X-Forwarded-For is present
    this.app.set('trust proxy', 1);

    // Parse JSON and URL-encoded bodies
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Security middlewares
    this.app.use(mongoSanitize());
    this.app.use(helmet());
    this.app.use(xss());
    this.app.use(hpp());
    
    // Rate limiting
    const limiter = rateLimit({
      windowMs: 10 * 60 * 1000, // 10 minutes
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        // Handle IPv6 addresses properly
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        return Array.isArray(ip) ? ip[0] : ip?.split(',').shift()?.trim() || 'unknown';
      }
    });
    this.app.use(limiter);
    
    this.app.use(hpp());
    this.app.use(cookieParser());

    // Session configuration
    this.app.use(session({
      secret: config.jwtSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 1 day
      }
    }));

    // Initialize Passport
    this.app.use(passport.initialize());
    this.app.use(passport.session());
  }


  // private initializeRoutes() {
  //   // Test routes for error handling
  //   this.app.get('/test-error', (_req, _res) => {
  //     // This will trigger our 404 handler
  //     throw createError.notFound('Test error message');
  //   });

  //   // Test route for different error types
  //   this.app.get('/test-errors/:type', (req, res) => {
  //     const { type } = req.params;
      
  //     switch (type) {
  //       case 'not-found':
  //         throw createError.notFound('Resource not found');
  //       case 'validation':
  //         throw createError.badRequest('Validation failed', { field: 'email', error: 'Invalid format' });
  //       case 'unauthorized':
  //         throw createError.unauthorized('Authentication required');
  //       case 'forbidden':
  //         throw createError.forbidden('Insufficient permissions');
  //       case 'server-error':
  //         throw new Error('Unexpected server error');
  //       default:
  //         res.json({
  //           success: true,
  //           message: 'Available test error types:',
  //           types: ['not-found', 'validation', 'unauthorized', 'forbidden', 'server-error']
  //         });
  //     }
  //   });

  //   // Health check endpoint
  //   this.app.get('/health', (_req, res) => {
  //     res.status(200).json({ status: 'ok' });
  //   });

  //   // Categories endpoint
  //   this.app.get('/api/categories', async (_req: Request, res: Response) => {
  //     try {
  //       await import('./modules/games/models/deck.model');
  //       const agg = await Deck.aggregate([
  //         { $match: { status: 'active' } },
  //         { $group: { _id: '$category' } },
  //         { $sort: { _id: 1 } }
  //       ]);
  //       const categories = (agg || []).map((c: any) => ({
  //         _id: c._id,
  //         name: String(c._id).charAt(0).toUpperCase() + String(c._id).slice(1)
  //       }));
  //       return res.status(200).json({ success: true, categories });
  //     } catch (err: any) {
  //       const message = err?.name === 'MongooseServerSelectionError' 
  //         ? 'Database connection failed' 
  //         : 'Failed to fetch categories';
  //       return res.status(500).json({ 
  //         success: false, 
  //         message, 
  //         error: err?.name || 'UnknownError' 
  //       });
  //     }
  //   });
  // }

  private initializeSocketIO() {
    if (!this.server) {
      throw new Error('HTTP server not initialized');
    }

    // Initialize Socket.IO
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.clientUrl || 'http://localhost:3000',
        methods: ['GET', 'POST']
      },
      path: '/ws/socket.io'
    });

    // Initialize WebSocket service
    initializeSocket(this.server, this.io);
    console.log('🔌 WebSocket server initialized');
  }

  private initializeErrorHandling() {
    // 404 handler - must be after all routes
    this.app.all('*', notFoundHandler);
    
    // Global error handler - must be after all middleware and routes
    this.app.use(globalErrorHandler);
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (err: Error) => {
      console.error('Unhandled Rejection:', err);
      // Close server & exit process
      this.server.close(() => process.exit(1));
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      console.error('Uncaught Exception:', err);
      // Close server & exit process
      this.server.close(() => process.exit(1));
    });
  }

  // setupProcessHandlers removed as it was unused and its functionality is covered by initializeErrorHandling

  private initializeRoutes(): void {
    // Health check endpoint - must be first to ensure it's always available
    this.app.get('/health', (_req: Request, res: Response) => {
      return res.status(200).json({ status: 'ok' });
    });

    // API routes
    if (authRoutes) this.app.use('/api/auth', authRoutes);
    if (profileRoutes) this.app.use('/api/user', profileRoutes);
    if (gameRoutes) this.app.use('/api/game', gameRoutes);
    if (dashboardRoutes) this.app.use('/api/dashboard', dashboardRoutes);
    
    // Test routes for error handling - only in development
    if (process.env.NODE_ENV !== 'production') {
      this.app.get('/test-error', (_req: Request, _res: Response) => {
        throw createError.notFound('Test error message');
      });

      this.app.get('/test-errors/:type', (req: Request, res: Response) => {
        const { type } = req.params;
        
        switch (type) {
          case 'not-found':
            throw createError.notFound('Resource not found');
          case 'validation':
            throw createError.badRequest('Validation failed', { field: 'email', error: 'Invalid format' });
          case 'unauthorized':
            throw createError.unauthorized('Authentication required');
          case 'forbidden':
            throw createError.forbidden('Insufficient permissions');
          case 'server-error':
            throw new Error('Unexpected server error');
          default:
            return res.json({
              success: true,
              message: 'Available test error types:',
              types: ['not-found', 'validation', 'unauthorized', 'forbidden', 'server-error']
            });
        }
      });
    }
    
    // Decks listing endpoint for clients (supports filters)
    this.app.get('/api/decks', async (req: Request, res: Response) => {
      try {
        const { category, status } = req.query as { category?: string; status?: string };
        const filter: { status: string; category?: string } = { status: 'active' };

        if (status && status !== 'all') {
          filter.status = status;
        }
        
        if (category && category !== 'all') {
          filter.category = category;
        }

        res.json({
          success: true,
          data: {
            filter,
            message: 'Endpoint working. Implement database query here.'
          }
        });
      } catch (error) {
        logger.error('Error in /api/decks:', error);
        res.status(500).json({
          success: false,
          message: 'An error occurred while fetching decks'
        });
      }
    });
  }
}

// Create and export a singleton instance of the App
const app = new App();

export default app;
