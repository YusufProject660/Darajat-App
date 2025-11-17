import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { config } from './env';
import { logger } from '../utils/logger';

const OAuth2 = google.auth.OAuth2;

const createTransporter = async () => {
  const oauth2Client = new OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  const accessToken = await new Promise((resolve, reject) => {
    oauth2Client.getAccessToken((err, token) => {
      if (err) {
        logger.error('Error getting access token:', err);
        reject(err);
      }
      resolve(token);
    });
  });

  const transporter = nodemailer.createTransport({
    auth: {
      type: 'OAuth2',
      user: process.env.EMAIL_USER || config.email?.user,
      accessToken: accessToken as string,
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN
    },
    debug: false,
    logger: false
  } as any);

  return transporter;
};

export default createTransporter;
