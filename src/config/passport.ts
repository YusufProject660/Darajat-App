import passport from "passport";
import {
  Strategy as GoogleStrategy,
  StrategyOptions,
  Profile,
  VerifyCallback,
} from "passport-google-oauth20";
import User, { IUser } from "../models/User";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET } from "../config";
import jwt, { JwtPayload } from "jsonwebtoken";

// Extend Express User type
declare global {
  namespace Express {
    interface User extends IUser {}
  }
}

// JWT Payload
export interface AuthJwtPayload extends JwtPayload {
  id: string;
  email: string;
}

const options: StrategyOptions = {
  clientID: GOOGLE_CLIENT_ID ?? "",
  clientSecret: GOOGLE_CLIENT_SECRET ?? "",
 callbackURL: process.env.CALLBACK_URL || "http://localhost:5000/auth/google/callback",
};

// Serialize / Deserialize
passport.serializeUser((user: IUser, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id).exec();
    done(null, user || null);
  } catch (err) {
    done(err as Error, null);
  }
});

// Google Strategy
passport.use(
  new GoogleStrategy(
    options,
    async (
      _accessToken: string,
      _refreshToken: string,
      profile: Profile,
      done: VerifyCallback
    ) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        console.log(profile);

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails?.[0].value,
            username: profile.displayName,
            
          });
        }

        // Sign JWT
        const token = jwt.sign(
          { id: user.id, email: user.email } as AuthJwtPayload,
          JWT_SECRET as string,
          { expiresIn: "1d" }
        );

        // You can attach the token to req.session or handle it in your route
        // For now, just pass the user object
        return done(null, user);
      } catch (err) {
        return done(err as Error, null);
      }
    }
  )
);

export default passport;
