import express, { Application, Request, Response } from 'express';
import http, { Server } from 'http';
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
import { config } from './config/env';
import { connectDB } from './config/db';
import authRoutes from './modules/users/auth.routes';
import profileRoutes from './modules/users/routes/profile.routes';
import gameRoutes from './modules/games/game.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import { initializeSocket } from './modules/games/services/socket.service';
import { errorMiddleware, notFoundHandler } from './middlewares/error.middleware';
import { AppError } from './utils/appError';
import { responseFormatter } from './middlewares/responseFormatter';
import 'express-async-errors';
import './config/passport';
import { logger, stream } from './utils/logger';
import { initializeTransporter } from './config/email';

export class App {
  public app: Application;
  public server: Server;
  public io?: SocketIOServer;
  private port: string | number;
  private isInitialized = false;
  private isTestEnv = process.env.NODE_ENV === 'test';

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.port = config.port || 5000;

    // Initialize core modules
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private start(): Promise<Server> {
    return new Promise((resolve, reject) => {
      const errorHandler = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`❌ Port ${this.port} is already in use`);
        } else {
          console.error('❌ Server error:', error);
        }
        reject(error);
        this.server.removeListener('error', errorHandler);
      };

      this.server.on('error', errorHandler);

      this.server.listen(this.port, () => {
        if (!this.isTestEnv) {
          console.log(`🚀 Server running on http://localhost:${this.port}`);
        }
        this.server.removeListener('error', errorHandler);
        resolve(this.server);
      });
    });
  }

  private async initializeDatabase(): Promise<void> {
    try {
      if (!this.isTestEnv) {
        await connectDB();
        // Initialize email transporter after database connection
        try {
          await initializeTransporter();
          logger.info('✅ Email transporter initialized successfully');
        } catch (error) {
          logger.warn('⚠️ Failed to initialize email transporter. Email functionality may be limited.');
          logger.error('Email transporter error:', error);
        }
      }
    } catch (error) {
      logger.error('Failed to connect to database:', error);
      throw error;
    }
  }

  public async initialize(): Promise<Server> {
    if (this.isInitialized && this.server) {
      logger.warn('⚠️  App is already initialized');
      return this.server;
    }

    try {
      await this.initializeDatabase();

      if (!this.isTestEnv) {
        logger.info('🚀 Starting HTTP server...');
        this.server = await this.start();
        logger.info('🔌 Initializing WebSocket...');
        this.initializeSocketIO();
      } else {
        // For test mode, create a mock server on a random port
        this.port = 0; // Let the OS assign an available port
        this.server = http.createServer(this.app);
        this.server.listen(this.port);
        logger.info('🧪 Test environment detected — created test server on random port');
      }

      // Add health check route
      this.app.get('/health', (_req: Request, res: Response) => {
        res.status(200).json({ status: 'ok' });
      });

      this.isInitialized = true;
      const address = this.server.address();
      const port = typeof address === 'string' ? address : address?.port;
      logger.info(`✅ Application running in ${config.nodeEnv} mode on port ${port}`);
      return this.server;
    } catch (error) {
      logger.error('❌ Failed to initialize application:', error);
      if (!this.isTestEnv) process.exit(1);
      throw error;
    }
  }

  private initializeMiddlewares() {
    this.app.use(morgan('combined', { stream }));

    const allowedOrigins = [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://localhost:3000',
      'http://localhost:5173',
      config.clientUrl
    ].filter(Boolean) as string[];

    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);

        const error = new Error(`Origin ${origin} not allowed by CORS`);
        logger.warn(error.message);
        return callback(error, false);
      },
      credentials: true,
      optionsSuccessStatus: 200,
      allowedHeaders: ['Content-Type', 'Authorization'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    };

    this.app.use(cors(corsOptions));
    this.app.set('trust proxy', 1);
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(mongoSanitize());
    this.app.use(helmet());
    this.app.use(xss());
    this.app.use(hpp());

    const limiter = rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        return Array.isArray(ip) ? ip[0] : ip?.split(',').shift()?.trim() || 'unknown';
      }
    });
    this.app.use(limiter);
    this.app.use(cookieParser());

    this.app.use(session({
      secret: config.jwtSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
      }
    }));

    this.app.use(passport.initialize());
    this.app.use(passport.session());
    
    // Add response formatter after all middleware but before routes
    this.app.use(responseFormatter);
  }

  private initializeRoutes(): void {
    // Health check route
    this.app.get('/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'ok' });
    });

    // API routes
    if (authRoutes) this.app.use('/api/auth', authRoutes);
    if (profileRoutes) this.app.use('/api/user', profileRoutes);
    if (gameRoutes) this.app.use('/api/game', gameRoutes);
    if (dashboardRoutes) this.app.use('/api/dashboard', dashboardRoutes);

    this.initializeTestRoutes();

    // Example decks endpoint
    this.app.get('/api/decks', async (req: Request, res: Response) => {
      try {
        const { category, status } = req.query as { category?: string; status?: string };
        const filter: { status: string; category?: string } = { status: 'active' };

        if (status && status !== 'all') filter.status = status;
        if (category && category !== 'all') filter.category = category;

        res.json({
          success: true,
          data: { filter, message: 'Endpoint working. Implement database query here.' }
        });
      } catch (error) {
        logger.error('Error in /api/decks:', error);
        res.status(500).json({ success: false, message: 'Error fetching decks' });
      }
    });
  }

  private initializeTestRoutes(): void {
    // Dev test routes
    if (process.env.NODE_ENV !== 'production') {
      this.app.get('/test-error', (_req: Request, _res: Response) => {
        throw AppError.notFound('Test error message');
      });

      this.app.get('/test-errors/:type', (req: Request, res: Response) => {
        const { type } = req.params;
        switch (type) {
          case 'not-found':
            throw AppError.notFound('Resource not found');
          case 'validation':
            throw AppError.badRequest('Validation failed', { field: 'email', error: 'Invalid format' });
          case 'unauthorized':
            throw AppError.unauthorized('Authentication required');
          case 'forbidden':
            throw AppError.forbidden('Insufficient permissions');
          case 'server-error':
            throw new Error('Unexpected server error');
          default:
            return res.json({
              success: true,
              message: 'Available test error types',
              types: ['not-found', 'validation', 'unauthorized', 'forbidden', 'server-error']
            });
        }
      });
    }

    // Example decks endpoint
    this.app.get('/api/decks', async (req: Request, res: Response) => {
      try {
        const { category, status } = req.query as { category?: string; status?: string };
        const filter: { status: string; category?: string } = { status: 'active' };

        if (status && status !== 'all') filter.status = status;
        if (category && category !== 'all') filter.category = category;

        res.json({
          success: true,
          data: { filter, message: 'Endpoint working. Implement database query here.' }
        });
      } catch (error) {
        logger.error('Error in /api/decks:', error);
        res.status(500).json({ success: false, message: 'Error fetching decks' });
      }
    });
  }

  private initializeSocketIO() {
    if (!this.server) throw new Error('HTTP server not initialized');

    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.clientUrl || 'http://localhost:3000',
        methods: ['GET', 'POST']
      },
      path: '/ws/socket.io'
    });

    initializeSocket(this.server, this.io);
    console.log('🔌 WebSocket server initialized');
  }

  private initializeErrorHandling(): void {
    // 404 handler
    this.app.all('*', notFoundHandler);

    // Global error handler
    this.app.use(errorMiddleware);
  }
}

const app = new App();
export default app;
