import { Request, Response } from "express";
import User from "../modules/users/user.model";
import jwt from "jsonwebtoken";
import { JWT_SECRET, JWT_EXPIRES_IN, GOOGLE_CLIENT_ID } from "../config";
import { sendEmail } from "../config/email";
// import { OAuth2Client } from "google-auth-library";

// const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const signToken = (user: any) => {
  return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, username } = req.body;
    const exists = await User.findOne({ email });
    if (exists) return res.apiError("Email already used", "EMAIL_EXISTS");
    
    const user = await User.create({ email, password, username });
    const token = signToken(user);
    res.apiSuccess({ token, user }, "Registration successful");
  } catch (error: any) {
    res.apiError(error.message || "Registration failed", "REGISTRATION_ERROR");
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.apiError("Invalid credentials", "INVALID_CREDENTIALS");
      
    const token = signToken(user);
    res.apiSuccess({ token, user }, "Login successful");
  } catch (error: any) {
    res.apiError(error.message || "Login failed", "LOGIN_ERROR");
  }
};

// export const googleLogin = async (req: Request, res: Response) => {
//   const { idToken } = req.body;
// //   console.log(idToken);
//   const ticket = await client.verifyIdToken({
//     idToken,
//     audience: GOOGLE_CLIENT_ID,
//   });
//   const payload = ticket.getPayload();
//   if (!payload || !payload.email)
//     return res.apiError("Invalid Google token", "INVALID_GOOGLE_TOKEN");
//   let user = await User.findOne({ email: payload.email });
//   if (!user) {
//     user = await User.create({
//       email: payload.email,

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) return res.apiError("User not found", "USER_NOT_FOUND");
  if (!user) return res.status(404).json({ message: "User not found" });

  const resetToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '1h' });
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

  const html = `
    <p>Hello ${user.username},</p>
    <p>You requested a password reset. Click the link below to reset your password:</p>
    <a href="${resetUrl}">Reset Password</a>
    <p>This link will expire in 1 hour.</p>
  `;

  try {
    await sendEmail(user.email, 'DaRajat App - Password Reset Request', html);
    return res.apiSuccess({}, 'Password reset email sent');
  } catch (err) {
    console.error(err);
    return res.apiSuccess({}, 'Logged out successfully');
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.apiSuccess({ token }, 'Google authentication successful');

  try {
    const payload: any = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.apiError('User not authenticated', 'UNAUTHENTICATED');

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    return res.apiSuccess({}, 'Password has been reset successfully');
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') return res.apiError('No token provided', 'MISSING_TOKEN');
    return res.apiSuccess({ role: 'admin' }, 'Admin access granted');
  }
};
