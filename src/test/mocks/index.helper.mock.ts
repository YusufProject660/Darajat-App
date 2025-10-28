// Mock implementations for external module

// Mock bcrypt
export const bcrypt = {
  hash: (password: string) => Promise.resolve(`hashed_${password}`),
  compare: (password: string, hashed: string) => 
    Promise.resolve(hashed === `hashed_${password}`),
};

// Mock jsonwebtoken
export const jwt = {
  sign: () => 'mock-jwt-token',
  verify: (token: string) => {
    if (token === 'valid-token') {
      return { id: 'mock-user-id', email: 'test@example.com' };
    }
    throw new Error('Invalid token');
  },
};

// Mock nodemailer
export const nodemailer = {
  createTransport: () => ({
    sendMail: () => Promise.resolve({ messageId: 'mock-message-id' }),
  }),
};

// Mock other modules as needed
export const mocks = {
  bcrypt,
  jwt,
  nodemailer,
  // Reset all mocks
  resetAllMocks: () => {
    // Reset any mock functions here if needed
  },
};

export default mocks;
