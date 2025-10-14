import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { randomBytes } from 'crypto';
import User, { ISerializedUser } from '../modules/users/user.model';
import { config } from './env';

// Extend Express User type to include our user properties
declare global {
  namespace Express {
    interface User extends ISerializedUser {}
  }
}

// Serialize user into the session
passport.serializeUser((user: Express.User, done) => {
  done(null, user._id); // no need toString, Mongoose ID is stringifiable
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
    {
      clientID: config.google.clientId,
      clientSecret: config.google.clientSecret,
      callbackURL: config.google.callbackUrl,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        // 1️⃣ Check if user already exists
        let user = await User.findOne({ googleId: profile.id }).lean();

        if (user) {
          // remove sensitive fields
          delete (user as any).password;
          delete (user as any).__v;
          return done(null, user as unknown as Express.User);
        }

        // 2️⃣ Create a new user if not exists
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

        const userObj = newUser.toObject();
        delete (userObj as any).password;
        delete (userObj as any).__v;

        done(null, userObj as unknown as Express.User);
      } catch (error) {
        done(error as Error, false);
      }
    }
  )
);

export default passport;