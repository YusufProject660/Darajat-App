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
  const { email, password, username } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(400).json({ message: "Email already used" });
  const user = await User.create({ email, password, username });
  const token = signToken(user);
  res.json({ token, user });
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ message: "Invalid credentials" });
  const token = signToken(user);
  res.json({ token, user });
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
//     return res.status(400).json({ message: "Invalid Google token" });
//   let user = await User.findOne({ email: payload.email });
//   if (!user) {
//     user = await User.create({
//       email: payload.email,
//       username: payload.name || payload.email.split("@")[0],
//       avatar: payload.picture,
//       googleId: payload.sub,
//     });
//   }
//   const token = signToken(user);
//   res.json({ token, user });
// };

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
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
    res.json({ message: "Password reset email sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send email" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) return res.status(400).json({ message: "Token and new password required" });

  try {
    const payload: any = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    res.json({ message: "Password has been reset successfully" });
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ message: "Reset token expired" });
    res.status(400).json({ message: "Invalid reset token" });
  }
};
