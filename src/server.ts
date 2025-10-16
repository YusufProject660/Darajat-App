import http from 'http';
import { App } from './app';
import { config } from './config/env';
import { connectDB } from './config/db';
const startServer = async (): Promise<void> => {
  try {
    const app = new App();
    app.listen();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  console.error('Unhandled Rejection:', err);
  // Close server & exit process
  process.exit(1);
});

// Handle SIGTERM and SIGINT signals for graceful shutdown
const shutdown = (server: http.Server) => {
  console.log('Shutting down server...');
  
  // Close the HTTP server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force close server after 5 seconds
  setTimeout(() => {
    console.error('Forcing server shutdown');
    process.exit(1);
  }, 5000);
};

// Start the server
const server = startServer();

// Handle process termination
process.on('SIGTERM', () => server.then(s => shutdown(s)));
process.on('SIGINT', () => server.then(s => shutdown(s)));
