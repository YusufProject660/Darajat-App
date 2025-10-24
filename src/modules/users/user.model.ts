import { Schema, model, Document, models } from 'mongoose';

// Interface for User document
export interface ISerializedUser {
  _id: string;
  id: string;
  username: string;
  email: string;
  avatar?: string;
  googleId?: string;
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  role: 'player' | 'admin';
  createdAt: Date;
  updatedAt: Date;
}

export interface IUser extends Document {
  _id: Schema.Types.ObjectId;
  username: string;
  email: string;
  password: string;
  avatar?: string;
  googleId?: string;
  stats: {
    gamesPlayed: number;
    accuracy: number;
    bestScore: number;
  };
  role: 'player' | 'admin';
  resetToken?: string;
  resetTokenExpires?: Date;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): boolean;
  confirmPassword?: string; // Virtual field for password confirmation
  _confirmPassword?: string; // Backing field for the virtual
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, 'Please add a username'],
      unique: true,
      trim: true,
      minlength: [3, 'Username must be at least 3 characters']
    },
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please add a valid email'
      ]
    },
    password: {
      type: String,
      required: [true, 'Please add a password'],
      minlength: 6,
      select: false
    },
    avatar: {
      type: String
    },
    googleId: {
      type: String,
      sparse: true,
      index: true
    },
    stats: {
      gamesPlayed: { type: Number, default: 0 },
      accuracy: { type: Number, default: 0 },
      bestScore: { type: Number, default: 0 }
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

// Add virtual for confirmPassword
userSchema.virtual('confirmPassword')
  .get(function(this: IUser) { return this._confirmPassword; })
  .set(function(this: IUser, value: string) { this._confirmPassword = value; });

// Method to match password (plain text comparison)
userSchema.methods.matchPassword = function (enteredPassword: string): boolean {
  return this.password === enteredPassword;
};

// Check if model exists before creating it to prevent OverwriteModelError
const User = models.User || model<IUser>('User', userSchema);

export default User;