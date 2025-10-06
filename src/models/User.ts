import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  email: string;
  username: string;
  password?: string; // optional for OAuth users
  avatar?: string;
  googleId?: string;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: {
      type: String,
      validate: {
        validator: function (value: string) {
          // Password is required only if googleId is not present
          if (!this.googleId && (!value || value.length === 0)) {
            return false;
          }
          return true;
        },
        message: 'Password is required for normal users',
      },
    },
    avatar: { type: String },
    googleId: { type: String },
  },
  { timestamps: true }
);

// Hash password only if modified or new
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (!this.password) return next(); // skip if password not provided (Google OAuth)
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method for login
UserSchema.methods.comparePassword = async function (candidatePassword: string) {
  if (!this.password) return false; // no password means cannot compare (OAuth user)
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model<IUser>('User', UserSchema);
