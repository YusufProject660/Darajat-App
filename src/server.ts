import http from 'http';
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import morgan from "morgan";
import "express-async-errors";
import dotenv from "dotenv";
import session from "express-session";
import passport from "passport";
import { config } from './config/env';
import { connectDB } from './config/db';
import { App } from './app';
import authRoutes from "./modules/users/auth.routes";
import gameRoutes from "./modules/games/game.routes";
import profileRoutes from "./modules/users/routes/profile.routes";

import { Server as SocketIOServer } from 'socket.io';
import { initializeSocket } from './modules/games/services/socket.service';

// Import passport strategies (Google, local, etc.)
import "./config/passport";

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
// Session configuration
app.use(
  session({
    secret: process.env.JWT_SECRET || 'your-secret-key', // Fallback to JWT_SECRET or a default
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 1 day
      sameSite: 'lax'
    },
    name: 'sessionId'
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/user", profileRoutes);
app.use("/api/game", gameRoutes);

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack || err.message);
  res.status(500).json({ message: "Server error" });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

// Start the server
const startServer = async (): Promise<http.Server> => {
  try {
    // Connect to database
    await connectDB();
    console.log('✅ MongoDB connected');

    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });

    // Initialize Socket.IO
    const io = new SocketIOServer(server, {
      cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:3000',
        methods: ['GET', 'POST']
      },
      path: '/ws/socket.io'
    });

    // Initialize WebSocket service
    initializeSocket(server, io);
    console.log('🔌 WebSocket server initialized');

    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
const shutdown = async (server: http.Server) => {
  console.log('🔴 Shutting down server...');
  
  // Close the HTTP server
  server.close(async () => {
    try {
      // Clean up any resources (like database connections, WebSocket connections, etc.)
      console.log('🔌 Closing WebSocket connections...');
      
      // If you have any other cleanup, do it here
      
      console.log('✅ Cleanup completed');
      console.log('🛑 Server closed');
      process.exit(0);
    } catch (error) {
      console.error('Error during cleanup:', error);
      process.exit(1);
    }
  });

  // Force close server after 5 seconds
  const forceShutdown = setTimeout(() => {
    console.error('⏱️ Forcing server shutdown');
    process.exit(1);
  }, 5000);

  // Prevent the force shutdown if the normal shutdown completes
  forceShutdown.unref();
};

// Start the server
const server = startServer();

// Handle process termination
process.on('SIGTERM', () => server.then(s => shutdown(s)));
process.on('SIGINT', () => server.then(s => shutdown(s)));