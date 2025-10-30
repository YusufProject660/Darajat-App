import nodemailer from 'nodemailer';
import { config } from './env';
import type { Transporter, SentMessageInfo } from 'nodemailer';

// Email configuration
const emailConfig = {
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '465', 10),
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  },
  debug: false,
  logger: false
};

// Logging function for important email events (only in development)
const log = (message: string, data?: any) => {
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📧 ${message}`, data || '');
  }
};

let transporter: Transporter | null = null;
let isInitializing = false;

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

// Initialize the transporter at startup
const initializeTransporter = async (): Promise<Transporter> => {
  if (transporter) {
    return transporter;
  }

  if (isInitializing) {
    throw new Error('Email transporter is already being initialized');
  }

  isInitializing = true;
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('Missing email credentials');
    }

    transporter = nodemailer.createTransport(emailConfig);

    // Verify connection
    await transporter.verify();
    return transporter;
  } catch (error) {
    const err = error as Error;
    log('❌ Failed to initialize email transporter:', {
      message: err.message,
      name: err.name,
      stack: err.stack
    });
    transporter = null;
    throw error;
  } finally {
    isInitializing = false;
  }
};

// Get the transporter instance
export const getTransporter = async (): Promise<Transporter> => {
  if (!transporter) {
    await initializeTransporter();
  }
  return transporter;
};

// Export the initialize function
export { initializeTransporter };

interface EmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export const sendEmail = async ({ to, subject, text, html }: EmailOptions): Promise<SentMessageInfo> => {
  console.log(`\n📤 Attempting to send email to: ${to}`);
  console.log(`   Subject: ${subject}`);

  try {
    // Get the transporter instance
    const mailTransporter = await getTransporter();

    const from = `"Darajat Support" <${process.env.EMAIL_USER}>`;
    console.log(`   From: ${from}`);

    const mailOptions: SendMailOptions = {
      from,
      to,
      subject,
      text: text || (html ? 'Please enable HTML to view this email' : ''),
      html,
    };

    console.log('   Sending email with options:', {
      to,
      subject,
      hasHtml: !!html,
      hasText: !!text,
    });

    log('Sending email through transporter...');
    
    const info = await mailTransporter.sendMail(mailOptions);
    
    log('✅ Email sent successfully', {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      pending: info.pending,
      response: info.response
    });
    
    return info;
  } catch (error: any) {
    const err = error as Error;
    log('❌ Error sending email:', {
      message: err.message,
      name: err.name,
      code: (err as any).code,
      command: (err as any).command,
      stack: err.stack
    });
    
    // More detailed error handling
    if (err.message.includes('Invalid login')) {
      log('❌ Authentication failed - check your email credentials');
    } else if (err.message.includes('Connection timeout')) {
      log('❌ Connection to SMTP server timed out - check your network connection');
    } else if (err.message.includes('ECONNREFUSED')) {
      log('❌ Connection refused - is the SMTP server running?');
    }
    
    throw new Error('Failed to send email: ' + err.message);
  }
};

export const sendPasswordResetEmail = async (email: string, resetUrl: string): Promise<SentMessageInfo> => {
  if (!email) {
    throw new Error('Email is required');
  }
  
  try {

    const subject = 'Password Reset Request';
    const text = `You are receiving this because you (or someone else) have requested the reset of the password for your account.\n\n` +
        `Please click on the following link, or paste this into your browser to complete the process:\n\n` +
        `${resetUrl}\n\n` +
        `If you did not request this, please ignore this email and your password will remain unchanged.\n`;
    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2>Password Reset</h2>
        <p>You requested to reset your password. Click the button below to set a new password:</p>
        <div style="margin: 25px 0;">
          <a href="${resetUrl}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Reset Password
          </a>
        </div>
        <p>Or copy and paste this link into your browser:</p>
        <p style="word-break: break-all; color: #0066cc;">${resetUrl}</p>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="font-size: 0.9em; color: #777;">This is an automated message, please do not reply to this email.</p>
      </div>
    `;

    const mailOptions = {
      from: `"Darajat" <${process.env.EMAIL_USER}>`,
      to: email,
      subject,
      text,
      html,
      // Add message ID and other headers for better tracking
      headers: {
        'X-Laziness-level': '1000', // Custom header for debugging
        'X-Application': 'Darajat Backend'
      }
    };
    
    const info = await sendEmail(mailOptions);
    
    if (process.env.NODE_ENV === 'development' && !process.env.GOOGLE_CLIENT_ID) {
      log('Test email preview URL:', nodemailer.getTestMessageUrl(info));
    }

    return info;
  } catch (error) {
    log('Error in sendPasswordResetEmail:', error);
    throw error;
  }
};
