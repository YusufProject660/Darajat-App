import { Router, Request, Response } from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config";
import * as auth from "../controllers/auth.controller";
import { IUser } from "../models/User";

const router = Router();

// Email/password routes
router.post("/register", auth.register);
router.post("/login", auth.login);
router.post("/forgot", auth.forgotPassword);

// Google OAuth: Start flow
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google OAuth: Callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  (req: Request, res: Response) => {
    const user = req.user as IUser;

    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET as string,
      { expiresIn: "1d" }
    );

    // Option 1: Redirect to frontend
    // res.redirect(`http://localhost:3000?token=${token}`);

    // Option 2: Send JSON
    res.json({ token, user });
  }
);

export default router;
