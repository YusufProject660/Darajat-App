import { App } from './app';
import http from 'http';
import mongoose from 'mongoose';
import './config/env'; // Import env configuration
import { logger } from './utils/logger';

// Create the app
const app = new App();

/**
 * Start the application server
 */
async function startServer(): Promise<http.Server> {
  try {
    logger.info('🚀 Starting server...');
    
    // Initialize the application
    const server = await app.initialize();
    
    // Set up graceful shutdown
    setupShutdownHandlers(server);
    
    return server;
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Set up shutdown handlers for graceful shutdown
 */
function setupShutdownHandlers(server: http.Server): void {
  const shutdown = async (signal: string) => {
    logger.info(`\n📴 Received ${signal}. Shutting down gracefully...`);
    
    try {
      // Close the server
      await new Promise<void>((resolve, reject) => {
        server.close(err => {
          if (err) {
            logger.error('Error during server shutdown:', err);
            return reject(err);
          }
          logger.info('✅ HTTP server closed');
          resolve();
        });
      });
      
      // Close database connection if exists
      if (mongoose.connection.readyState === 1) { // 1 = connected
        await mongoose.connection.close();
        logger.info('✅ Database connection closed');
      }
      
      logger.info('👋 Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle different shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('🚨 Uncaught Exception:', error);
    shutdown('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
  });
}

// Start the server
startServer().catch(error => {
  logger.error('❌ Fatal error during startup:', error);
  process.exit(1);
});
