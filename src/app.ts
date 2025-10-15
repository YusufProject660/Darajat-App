import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import helmet from 'helmet';
import xss from 'xss-clean';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import session from 'express-session';
import { config } from './config/env';
import { connectDB } from './config/db';
import passport from './config/passport';
import authRoutes from './modules/users/auth.routes';
import gameRoutes from './modules/games/game.routes';
import { errorHandler, notFound } from './utils/errorResponse';

class App {
  public app: Application;

  constructor() {
    this.app = express();
    
    connectDB();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares() {
    this.app.use(helmet());
    this.app.use(cors({
      origin: config.clientUrl,
      credentials: true
    }));
    
    this.app.set('trust proxy', 1);
    
    const limiter = rateLimit({
      windowMs: 10 * 60 * 1000,
      max: 100
    });
    this.app.use(limiter);
    
    this.app.use(express.json({ limit: '10kb' }));
    this.app.use(cookieParser());
    
    // Session middleware (required for Passport)
    this.app.use(
      session({
        secret: config.jwtSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: config.nodeEnv === 'production',
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000 // 24 hours
        }
      })
    );
    
    // Passport initialization
    this.app.use(passport.initialize());
    this.app.use(passport.session());
    
    this.app.use(mongoSanitize());
    this.app.use(xss());
    this.app.use(hpp());
    
    if (config.nodeEnv === 'development') {
      this.app.use((req: Request, _res: Response, next: NextFunction) => {
        console.log(`${req.method} ${req.originalUrl}`);
        next();
      });
    }
  }

  private initializeRoutes() {
    this.app.get('/api/health', (_req: Request, res: Response) => {
      res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
    });
    
    this.app.use('/api/auth', authRoutes);
    this.app.use('/api/game', gameRoutes);
    
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({ message: 'Not Found' });
    });
  }

  private initializeErrorHandling() {
    this.app.use(notFound);
    this.app.use(errorHandler);
  }

  public listen() {
    const PORT = config.port || 5000;
    this.app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Environment: ${config.nodeEnv}`);
    });
  }
}

export default new App();
