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
    // Enable CORS
    this.app.use(cors({
      origin: config.clientUrl || '*',
      credentials: true
    }));

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
      max: 100
    });
    this.app.use(limiter);
    
    this.app.use(hpp());
    this.app.use(cookieParser());

    // Session configuration
    this.app.use(session({
      secret: config.jwtSecret, // Using JWT secret for session
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
    this.app.use('/api/games', gameRoutes);
    
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
