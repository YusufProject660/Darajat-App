// Token blacklist using in-memory Set
const tokenBlacklist = new Set<string>();

export const addToBlacklist = (token: string) => {
  tokenBlacklist.add(token);};

export const isTokenBlacklisted = (token: string): boolean => {
  return tokenBlacklist.has(token);};

// Optional: Add a function to clear expired tokens periodically
const clearExpiredTokens = () => {
  // This is a basic implementation
  // In production, you might want to implement a more sophisticated solution
  // that tracks token expiration times
  // and removes expired tokens from the blacklist
  setInterval(() => {
    // Clear the blacklist every 24 hours
    tokenBlacklist.clear();
  }, 24 * 60 * 60 * 1000);
};

// Start the cleanup process
clearExpiredTokens();
