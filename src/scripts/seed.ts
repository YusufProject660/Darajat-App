import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { MONGO_URI } from '../config';

dotenv.config();

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected for seeding'))
    .catch(err => console.error(err))
    .finally(() => mongoose.disconnect());