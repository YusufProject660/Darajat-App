import passport from 'passport';
import { Strategy as GoogleStrategy, StrategyOptions, Profile, VerifyCallback } from 'passport-google-oauth20';
import { randomBytes } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from './env';
import User, { IUser } from '../modules/users/user.model';

// Extend Express User type to include our user properties
declare global {
  namespace Express {
    interface User extends Omit<IUser, 'password' | 'confirmPassword' | '_confirmPassword' | 'resetToken' | 'resetTokenExpires' | 'matchPassword'> {}
  }
}

// JWT Payload
export interface AuthJwtPayload extends JwtPayload {
  id: string;
  email: string;
}

// Google OAuth Strategy Options
const googleStrategyOptions: StrategyOptions = {
  clientID: config.google.clientId,
  clientSecret: config.google.clientSecret,
  callbackURL: config.google.callbackUrl,
};

// Serialize user into the session
passport.serializeUser((user: Express.User, done) => {
  done(null, user._id);
});

// Deserialize user from the session
passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id)
      .select('-password -__v -confirmPassword -_confirmPassword')
      .lean();

    if (!user) return done(null, false);
    done(null, user as unknown as Express.User);
  } catch (error) {
    done(error as Error);
  }
});

// Google OAuth Strategy
passport.use(
  new GoogleStrategy(
    googleStrategyOptions,
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        // Check if user already exists
        let user = await User.findOne({ googleId: profile.id }).lean();

        if (user) {
          // Remove sensitive fields
          const { password, __v, ...safeUser } = user as any;
          return done(null, safeUser as Express.User);
        }

        // Create a new user if not exists
        const email = profile.emails?.[0]?.value || '';
        let username = profile.displayName || `user_${profile.id.slice(0, 8)}`;
        const avatar = profile.photos?.[0]?.value || '';

        // Check if username already exists and append a random string if it does
        const usernameExists = await User.findOne({ username });
        if (usernameExists) {
          username = `${username}_${randomBytes(4).toString('hex')}`;
        }

        try {
          const newUser = await User.create({
            googleId: profile.id,
            email,
            username,
            avatar,
            role: 'player',
            authProvider: 'google',
            isOAuthUser: true,
            hasPassword: false,
            stats: {
              gamesPlayed: 0,
              accuracy: 0,
              bestScore: 0,
            }
            // No password field for OAuth users
          });

          // Generate JWT token
          const token = jwt.sign(
            { id: newUser._id, email: newUser.email } as AuthJwtPayload,
            config.jwtSecret,
            { expiresIn: '30d' }
          );

          // Remove sensitive data
          const userObj = newUser.toObject();
          delete (userObj as any).password;
          delete (userObj as any).__v;

          // Attach token to user object
          const userWithToken = {
            ...userObj,
            token,
          };

          return done(null, userWithToken as unknown as Express.User);
        } catch (error: any) {
          if (error.code === 11000) {
            // If there's a duplicate key error (for email or other unique fields)
            const duplicateField = Object.keys(error.keyPattern)[0];
            return done(new Error(`A user with this ${duplicateField} already exists`));
          }
          return done(error);
        }
      } catch (error) {
        return done(error as Error);
      }
    }
  )
);

export default passport;