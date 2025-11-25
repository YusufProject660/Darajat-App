import express, { Application, Request, Response } from 'express';
import path from 'path';
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
import { setupSocketHandlers } from './modules/games/socket.handler';
import { gameService } from './modules/games/services/game.service';
import { errorMiddleware, notFoundHandler } from './middlewares/error.middleware';
import { AppError } from './utils/appError';
import { responseFormatter } from './middlewares/responseFormatter';
import 'express-async-errors';
import './config/passport';
import { logger, stream } from './utils/logger';
import { initializeTransporter } from './services/email.service';

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
          logger.error(`❌ Port ${this.port} is already in use`);
        } else {
          logger.error('❌ Server error:', error);
        }
        reject(error);
        this.server.removeListener('error', errorHandler);
      };

      this.server.on('error', errorHandler);

      this.server.listen(this.port, () => {
        if (!this.isTestEnv) {
          logger.info(`🚀 Server running on http://localhost:${this.port}`);
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
    // Global JSON parser with raw body capture for auth routes
    this.app.use(
      express.json({
        verify: (req, _res, buf) => {
          const expressReq = req as Request;
          if (expressReq.path?.startsWith('/api/auth/')) {
            (expressReq as any).rawBody = buf?.toString('utf8');
          }
        },
      })
    );

    // Add request timeout middleware (30 seconds)
    this.app.use((req, res, next) => {
      const timeout = 30000; // 30 seconds
      const timer = setTimeout(() => {
        if (!res.headersSent) {
          logger.warn(`⚠️ Request timeout after ${timeout}ms: ${req.method} ${req.originalUrl}`);
          res.status(200).json({
            status: 0,
            message: 'Request timeout. The server is taking too long to respond.',
            code: 'REQUEST_TIMEOUT'
          });
        }
      }, timeout);

      // Clean up the timeout on response finish/close/error
      res.on('finish', () => clearTimeout(timer));
      res.on('close', () => clearTimeout(timer));
      res.on('error', () => clearTimeout(timer));
      next();
    });

    // Development-only request logging middleware
    if (process.env.NODE_ENV === 'development') {
      this.app.use((req, res, next) => {
        // Skip logging for health checks and static files
        if (req.path === '/health' || req.path.startsWith('/static/')) {
          return next();
        }

        const start = Date.now();
        const originalEnd = res.end.bind(res);
        
        // @ts-ignore - We're extending the response object with overloaded signature
        res.end = function (chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void) {
          const duration = Date.now() - start;
          
          // Clone and sanitize request body for logging
          let logData: any = {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`
          };

          // Only log request body for non-GET requests and if body exists
          if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
            const sensitiveFields = ['password', 'token', 'refreshToken', 'accessToken', 'authorization'];
            const sanitizedBody = JSON.parse(JSON.stringify(req.body));
            
            // Redact sensitive fields
            sensitiveFields.forEach(field => {
              if (sanitizedBody[field]) {
                sanitizedBody[field] = '[REDACTED]';
              }
            });
            
            logData.body = sanitizedBody;
          }

          logger.debug('Request:', logData);
          
          // Call original end method - handle overloaded signatures
          // @ts-ignore - Express res.end has overloaded signatures
          return originalEnd(chunk, encodingOrCb, cb);
        };
        
        next();
      });
    }
    
    // Serve static files from the public directory
    // Use process.cwd() for reliable path resolution (project root)
    const publicDir = path.join(process.cwd(), 'public');
    this.app.use(express.static(publicDir));
    
    // Add morgan logging
    this.app.use(morgan('combined', { stream }));
    
    // Default development origins
    const devOrigins = [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:8000',
      'http://localhost:8080',
      /^https?:\/\/localhost(:\d+)?$/, // Match any localhost with any port
    ];

    // Production origins from config and environment
    const productionOrigins = [
      config.clientUrl,
      config.frontendUrl,
      process.env.FRONTEND_URL,
      process.env.CLIENT_URL,
      // Add common production domains here if needed
    ].filter(Boolean) as string[];

    // Combine origins based on environment
    const allowedOrigins = process.env.NODE_ENV === 'production' 
      ? productionOrigins
      : [...devOrigins, ...productionOrigins];

    const corsOptions = {
      origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps, curl, etc)
        if (!origin) {
          if (process.env.NODE_ENV === 'production') {
            logger.debug('Request with no origin - allowing in production');
          }
          return callback(null, true);
        }

        // Check if origin matches any allowed pattern
        const isAllowed = allowedOrigins.some(allowedOrigin => {
          if (typeof allowedOrigin === 'string') {
            return origin === allowedOrigin;
          } else if (allowedOrigin instanceof RegExp) {
            return allowedOrigin.test(origin);
          }
          return false;
        });

        if (isAllowed) {
          return callback(null, true);
        }

        const error = new Error(`Origin '${origin}' not allowed by CORS`);
        logger.warn(`CORS violation: ${error.message}. Allowed origins: ${JSON.stringify(allowedOrigins)}`);
        
        // In development, allow all origins but log a warning
        if (process.env.NODE_ENV !== 'production') {
          logger.warn(`Allowing origin '${origin}' in development mode`);
          return callback(null, true);
        }
        
        return callback(error, false);
      },
      credentials: true,
      optionsSuccessStatus: 200,
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With',
        'Accept',
        'X-Access-Token',
        'X-Refresh-Token'
      ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      exposedHeaders: ['Content-Range', 'X-Total-Count']
    };

    this.app.use(cors(corsOptions));
    this.app.set('trust proxy', 1);
    
    // Middleware to preserve empty strings in request body
    this.app.use((req, _res, next) => {
      if (req.body) {
        const preserveEmptyStrings = (obj: any) => {
          if (obj === null || obj === undefined) return obj;
          if (typeof obj === 'object') {
            for (const key in obj) {
              if (obj[key] === '') {
                // Keep empty strings as is
                obj[key] = '';
              } else if (typeof obj[key] === 'object') {
                preserveEmptyStrings(obj[key]);
              }
            }
          }
          return obj;
        };
        
        preserveEmptyStrings(req.body);
      }
      next();
    });
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
    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Serve static files from public directory
    const publicDir = path.join(process.cwd(), 'public');
    this.app.use(express.static(publicDir));
    
    // Serve uploads directory for profile pictures
    this.app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
    
    // Serve game-test.html explicitly (for backward compatibility)
    this.app.get('/game-test.html', (_req, res) => {
      const filePath = path.join(publicDir, 'game-test.html');
      res.sendFile(filePath, (err) => {
        if (err) {
          logger.error(`Error serving game-test.html: ${err.message}`);
          res.status(404).json({
            status: 0,
            message: `File not found: ${filePath}`
          });
        }
      });
    });

    // API routes
    if (authRoutes) this.app.use('/api/auth', authRoutes);
    if (profileRoutes) this.app.use('/api/user', profileRoutes);
    if (gameRoutes) this.app.use('/api/game', gameRoutes);
    if (dashboardRoutes) this.app.use('/api/dashboard', dashboardRoutes);

    this.initializeTestRoutes();
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
  }

  private initializeSocketIO() {
    if (!this.server) throw new Error('HTTP server not initialized');

    try {
      // Create the Socket.IO server with all configuration
      this.io = new SocketIOServer(this.server, {
        cors: {
          origin: process.env.NODE_ENV === 'production' 
            ? process.env.FRONTEND_URL || 'https://your-production-domain.com'
            : '*',
          methods: ['GET', 'POST'],
          credentials: true
        },
      
        maxHttpBufferSize: 1e8, // 100MB
        connectTimeout: 30000,  // 30 seconds
        transports: ['websocket', 'polling'],
        pingInterval: 30000,   // 30 seconds
        pingTimeout: 60000,    // 60 seconds
        // @ts-ignore - The types might be outdated, but these properties are valid in v4
        allowEIO3: true        // Enable compatibility with older clients if needed
      });

      // Setup socket handlers (functional approach)
      setupSocketHandlers(this.io);
      
      // Initialize game service with socket instance
      gameService.initialize(this.io);
      
      // Store socket instance in Express app for controller access
      this.app.set('io', this.io);
      
      // Console log for socket initialization
      console.log('═══════════════════════════════════════════════════════════');
      console.log('🔌 SOCKET.IO INITIALIZATION');
      console.log('═══════════════════════════════════════════════════════════');
      console.log('✅ Socket.IO server initialized successfully');
      console.log('Path: /socket.io (default)');
      console.log('CORS Origin:', process.env.NODE_ENV === 'production' 
        ? process.env.FRONTEND_URL || 'https://your-production-domain.com'
        : '*');
      console.log('Transports:', ['websocket', 'polling']);
      console.log('Ping Interval: 30s');
      console.log('Ping Timeout: 60s');
      console.log('Socket instance stored in app.set("io")');
      console.log('═══════════════════════════════════════════════════════════');
      
      logger.info('✅ WebSocket server initialized');

    } catch (error) {
      logger.error('❌ Failed to initialize Socket.IO:', error);
      throw error;
    }
  }
  private initializeErrorHandling(): void {
    // 404 handler
    this.app.all('*', notFoundHandler);

    // Global error handler
    this.app.use(errorMiddleware);
  }
}

// App class is exported for use in index.ts
