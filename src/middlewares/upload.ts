// src/middlewares/upload.ts
import multer from 'multer';
import path from 'path';
import { Request } from 'express';
import fs from 'fs-extra';

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../../uploads/profile-pictures');
fs.ensureDirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    cb(null, uploadDir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const filetypes = /jpeg|jpg|png|webp/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype);
  if (mimetype && extname) return cb(null, true);
  cb(new Error('Only .png, .jpg, .jpeg, and .webp formats are allowed.'));
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB max
});