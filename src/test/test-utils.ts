import { App } from '../app';
import http from 'http';
import mongoose from 'mongoose';

let testApp: App;
let testServer: http.Server;

/**
 * Initialize the test application
 */
export const initTestApp = async (): Promise<{ app: App; server: http.Server }> => {
  process.env.NODE_ENV = 'test';
  
  testApp = new App();
  testServer = await testApp.initialize();
  
  return { app: testApp, server: testServer };
};

/**
 * Close the test application
 */
export const closeTestApp = async (): Promise<void> => {
  if (testServer) {
    await new Promise<void>((resolve, reject) => {
      testServer.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  // Close the default Mongoose connection
  await mongoose.connection.close();
};
