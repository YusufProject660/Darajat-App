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
import { Server as SocketIOServer, Socket } from 'socket.io';
import { config } from './config/env';
import { connectDB } from './config/db';
import passport from './config/passport';
import authRoutes from './modules/users/auth.routes';
import profileRoutes from './modules/users/routes/profile.routes';
import gameRoutes from './modules/games/game.routes';
import { createWebSocketRouter } from './modules/games/websocket.routes';
import { errorHandler, notFound } from './utils/errorResponse';

export class App {
  public app: Application;
  public server: http.Server;
  public io?: SocketIOServer;
  private port: string | number;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.port = config.port || 5000;
    
    // Initialize database connection
    connectDB();
    
    // Initialize middlewares
    this.initializeMiddlewares();
    
    // Initialize routes
    this.initializeRoutes();
    
    // Initialize error handling
    this.initializeErrorHandling();
  }
  
  private initializeMiddlewares() {
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
        console.warn(error.message);
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

    // Initialize passport
    this.app.use(passport.initialize());
    this.app.use(passport.session());
  }
  
  private initializeRoutes() {
    // API routes
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/user', profileRoutes);
    this.app.use('/api/games', gameRoutes);
    // Decks listing endpoint for clients (supports filters)
    this.app.get('/api/decks', async (req: Request, res: Response) => {
      try {
        const { Deck } = await import('./modules/games/models/deck.model');
        const { category, difficulty, status } = (req.query || {}) as Record<string, string | undefined>;

        const filter: any = {};
        if (typeof status === 'string' && status.length > 0 && status !== 'all') {
          filter.status = status;
        } else {
          filter.status = 'active';
        }
        if (typeof category === 'string' && category.length > 0 && category !== 'all') {
          filter.category = category;
        }
        if (typeof difficulty === 'string' && difficulty.length > 0 && difficulty !== 'all') {
          filter.difficulty = difficulty;
        }

        const decks = await Deck.find(filter)
          .select('_id name category difficulty status questionCount createdAt')
          .sort({ createdAt: -1 })
          .lean();
        res.json({ success: true, decks });
      } catch (error: any) {
        res.status(500).json({ success: false, message: 'Failed to fetch decks', error: error?.name || 'UnknownError' });
      }
    });

    // Categories endpoint: returns unique categories from Decks
    this.app.get('/api/categories', async (_req: Request, res: Response) => {
      try {
        const { Deck } = await import('./modules/games/models/deck.model');
        const agg = await Deck.aggregate([
          { $match: { status: 'active' } },
          { $group: { _id: '$category' } },
          { $sort: { _id: 1 } }
        ]);
        const categories = (agg || []).map((c: any) => ({
          _id: c._id,
          name: String(c._id).charAt(0).toUpperCase() + String(c._id).slice(1)
        }));
        return res.status(200).json({ success: true, categories });
      } catch (err: any) {
        const message = err?.name === 'MongooseServerSelectionError' ? 'Database connection failed' : 'Failed to fetch categories';
        return res.status(500).json({ success: false, message, error: err?.name || 'UnknownError' });
      }
    });
    
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.status(200).json({ status: 'ok' });
    });
  }
  
  private initializeErrorHandling() {
    // 404 handler
    this.app.use(notFound);
    
    // Global error handler
    this.app.use(errorHandler);
  }
  
  public initializeWebSocket(): void {
    // Initialize Socket.IO with proper CORS and path
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.clientUrl || '*',
        methods: ['GET', 'POST'],
        credentials: true
      },
      path: '/ws/socket.io'
    });

    // Initialize WebSocket event handlers
    this.initializeWebSocketHandlers();
  }
  
  private initializeWebSocketHandlers(): void {
    if (!this.io) return;
    
    // Initialize the proper websocket routes
    createWebSocketRouter(this.io);
  }
  
  public listen() {
    this.server.listen(this.port, () => {
      console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${this.port}`);
      this.initializeWebSocket();
      console.log(`WebSocket server running on ws://localhost:${this.port}/ws`);
    });
  }

  public getServer() {
    return this.server;
  }

  public getIO() {
    return this.io;
  }
}

export default App;
