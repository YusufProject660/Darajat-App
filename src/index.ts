import dotenv from 'dotenv';
import { App } from './app';
import http from 'http';
import mongoose from 'mongoose';

// Load environment variables
dotenv.config();

// Create the app
const app = new App();

/**
 * Start the application server
 */
async function startServer(): Promise<http.Server> {
  try {
    console.log('🚀 Starting server...');
    
    // Initialize the application
    const server = await app.initialize();
    
    // Set up graceful shutdown
    setupShutdownHandlers(server);
    
    return server;
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Set up shutdown handlers for graceful shutdown
 */
function setupShutdownHandlers(server: http.Server): void {
  const shutdown = async (signal: string) => {
    console.log(`\n📴 Received ${signal}. Shutting down gracefully...`);
    
    try {
      // Close the server
      await new Promise<void>((resolve, reject) => {
        server.close(err => {
          if (err) {
            console.error('Error during server shutdown:', err);
            return reject(err);
          }
          console.log('✅ HTTP server closed');
          resolve();
        });
      });
      
      // Close database connection if exists
      if ((app as any).dbConnection) {
        await mongoose.connection.close();
        console.log('✅ Database connection closed');
      }
      
      console.log('👋 Shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  };

  // Handle different shutdown signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    shutdown('uncaughtException');
  });
  
  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('unhandledRejection');
  });
}

// Start the server
startServer().catch(error => {
  console.error('❌ Fatal error during startup:', error);
  process.exit(1);
});
