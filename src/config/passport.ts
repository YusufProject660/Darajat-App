import passport from 'passport';
import { Strategy as GoogleStrategy, StrategyOptions, Profile, VerifyCallback } from 'passport-google-oauth20';
import { randomBytes } from 'crypto';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { config } from './env';
import User, { ISerializedUser } from '../modules/users/user.model';

// Extend Express User type to include our user properties
declare global {
  namespace Express {
    interface User extends ISerializedUser {}
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
        const username = profile.displayName || `user_${profile.id.slice(0, 8)}`;
        const avatar = profile.photos?.[0]?.value || '';

        const newUser = await User.create({
          googleId: profile.id,
          email,
          username,
          avatar,
          role: 'player',
          stats: {
            gamesPlayed: 0,
            accuracy: 0,
            bestScore: 0,
          },
          password: randomBytes(20).toString('hex'), // Random placeholder password
        });

        // Generate JWT token
        const token = jwt.sign(
          { id: newUser._id, email: newUser.email } as AuthJwtPayload,
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn }
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

        done(null, userWithToken as unknown as Express.User);
      } catch (error) {
        done(error as Error);
      }
    }
  )
);

export default passport;