import { Schema, model, Document, models } from 'mongoose';

export interface IFirebaseUser extends Document {
  _id: Schema.Types.ObjectId;
  firebase_uid: string;
  email: string;
  first_name: string;
  last_name: string;
  createdAt: Date;
  updatedAt: Date;
}

const firebaseUserSchema = new Schema<IFirebaseUser>(
  {
    firebase_uid: {
      type: String,
      required: [true, 'Firebase UID is required'],
      unique: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      validate: {
        validator: function(v: string) {
          const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
          if (!emailRegex.test(v)) {
            return false;
          }
          
          const [localPart, domainPart] = v.split('@');
          
          if (localPart.length < 1 || localPart.length > 64) {
            return false;
          }
          
          if (domainPart.length < 1 || domainPart.length > 255) {
            return false;
          }
          
          if (domainPart.includes('..') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
            return false;
          }
          
          const domainParts = domainPart.split('.');
          if (domainParts.length < 2 || domainParts.some(part => part.length === 0)) {
            return false;
          }
          
          const tld = domainParts[domainParts.length - 1];
          if (tld.length < 2 || tld.length > 63) {
            return false;
          }
          
          return true;
        },
        message: 'Please enter a valid email address'
      }
    },
    first_name: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot be more than 50 characters']
    },
    last_name: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot be more than 50 characters']
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
      }
    }
  }
);

// Index for faster querying by name combination
firebaseUserSchema.index({ first_name: 1, last_name: 1 });

// Check if model exists before creating it to prevent OverwriteModelError
const FirebaseUser = models.FirebaseUser || model<IFirebaseUser>('FirebaseUser', firebaseUserSchema);

export default FirebaseUser;

