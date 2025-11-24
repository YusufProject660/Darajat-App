import { Schema, model, Document, models, HydratedDocument } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser extends Document {
  _id: Schema.Types.ObjectId;
  username: string;
  firstName: string;
  lastName?: string;
  email: string;
  password?: string; // Make password optional for OAuth users
  avatar?: string;
  googleId?: string;
  firebase_uid?: string;
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  role: 'player' | 'admin';
  resetToken?: string;
  resetTokenExpires?: Date;
  lastResetRequest?: Date;
  authProvider?: 'google' | 'email';
  isOAuthUser?: boolean;
  hasPassword?: boolean; // Explicitly track if user has a password set
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, 'First name cannot be more than 50 characters']
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, 'Last name cannot be more than 50 characters']
    },
    username: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: function(v: string) {
          // More restrictive email validation
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          if (!emailRegex.test(v)) {
            return false;
          }
          
          const [localPart, domainPart] = v.split('@');
          
          // Check local part length (1-64 chars as per RFC 5321)
          if (localPart.length < 1 || localPart.length > 64) {
            return false;
          }
          
          // Check domain part length (1-255 chars as per RFC 5321)
          if (domainPart.length < 1 || domainPart.length > 255) {
            return false;
          }
          
          // Check for consecutive dots or invalid starting/ending characters
          if (domainPart.includes('..') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
            return false;
          }
          
          // Check domain parts
          const domainParts = domainPart.split('.');
          if (domainParts.length < 2 || domainParts.some(part => part.length === 0)) {
            return false;
          }
          
          // Check TLD length (at least 2 chars, max 63)
          const tld = domainParts[domainParts.length - 1];
          if (tld.length < 2 || tld.length > 63) {
            return false;
          }
          
          return true;
        },
        message: 'Please enter a valid email address'
      }
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      maxlength: [20, 'Password must be less than or equal to 20 characters'],
      validate: {
        validator: function(v: string) {
          return v.length <= 20;
        },
        message: 'Password must be less than or equal to 20 characters'
      },
      select: false // Don't return password by default
    },
    authProvider: {
      type: String,
      enum: ['google', 'email'],
      default: 'email'
    },
    isOAuthUser: {
      type: Boolean,
      default: false
    },
    hasPassword: {
      type: Boolean,
      default: false
    },
    avatar: {
      type: String
    },
    googleId: {
      type: String,
      sparse: true,
      index: true
    },
    firebase_uid: {
      type: String,
      sparse: true,
      unique: true,
      trim: true,
      index: true
    },
    stats: {
      gamesPlayed: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 },
      totalCorrectAnswers: { type: Number, default: 0 },
      totalQuestionsAnswered: { type: Number, default: 0 },
      totalTimePlayed: { type: Number, default: 0 }
    },
    role: {
      type: String,
      enum: ['player', 'admin'],
      default: 'player'
    },
    resetToken: {
      type: String,
      select: false
    },
    resetTokenExpires: {
      type: Date,
      select: false
    },
    lastResetRequest: {
      type: Date,
      select: false
    }
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      versionKey: false,
      transform: function (_, ret: Record<string, any>) {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        delete ret.password; // Don't send password in responses
      }
    }
  }
);

// UNUSED: Virtual field for password confirmation
// userSchema.virtual('confirmPassword')
//   .get(function(this: IUser) { return this._confirmPassword; })
//   .set(function(this: IUser, value: string) { this._confirmPassword = value; });

// Hash password before saving
userSchema.pre('save', async function(this: HydratedDocument<IUser>, next) {
  // Only hash the password if it's been modified (or is new) and is not already hashed
  if (!this.isModified('password') || !this.password) return next();
  
  // Check if password is already hashed
  const isAlreadyHashed = this.password.startsWith('$2a$') || 
                         this.password.startsWith('$2b$') || 
                         this.password.startsWith('$2y$');
  
  if (isAlreadyHashed) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Method to compare password
userSchema.methods.matchPassword = async function(enteredPassword: string): Promise<boolean> {
  // For OAuth users without password
  if (this.isOAuthUser || !this.password) {
    throw new Error('This account uses OAuth for authentication. Please sign in with your OAuth provider.');
  }
  return bcrypt.compare(enteredPassword, this.password);
};

// Check if model exists before creating it to prevent OverwriteModelError
const User = models.User || model<IUser>('User', userSchema);

export default User;