import nodemailer, { Transporter, SentMessageInfo } from 'nodemailer';

// Email configuration with improved reliability settings
const emailConfig = {
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: process.env.NODE_ENV === 'production'
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000,
  debug: false,
  logger: false
};

// Logging function for important email events
const log = (message: string, data?: any) => {
  if (process.env.NODE_ENV !== 'production') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] 📧 ${message}`, data || '');
  }
};

let transporter: Transporter | null = null;
let isInitializing = false;

interface IEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

// Initialize the transporter
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
    await transporter.verify();
    log('✅ Email transporter initialized successfully');
    return transporter;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
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

// Helper function to create a timeout promise
const createTimeout = <T>(ms: number, message: string): Promise<T> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
};

// Send email function
const sendEmail = async (options: IEmailOptions): Promise<SentMessageInfo> => {
  const startTime = Date.now();
  const { to, subject, text, html } = options;
  
  log(`Sending email to: ${to}, Subject: ${subject}`);

  try {
    // Get or create transporter with timeout
    const mailTransporter = await Promise.race([
      initializeTransporter(),
      createTimeout<Transporter>(10000, 'Timed out while initializing email transporter')
    ]);

    const from = `"Darajat Support" <${process.env.EMAIL_USER}>`;
    
    const mailOptions = {
      from,
      to,
      subject,
      text: text || (html ? 'Please enable HTML to view this email' : ''),
      html
    };

    // Send email with timeout
    const sendPromise = mailTransporter.sendMail(mailOptions);
    const info = await Promise.race([
      sendPromise,
      createTimeout<SentMessageInfo>(15000, 'Email sending timed out after 15 seconds')
    ]);
    
    const timeElapsed = Date.now() - startTime;
    log(`✅ Email sent successfully in ${timeElapsed}ms`, {
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected
    });
    
    return info;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    log('❌ Error sending email:', {
      message: err.message,
      name: err.name,
      code: (err as any).code,
      stack: err.stack
    });
    
    if (err.message.includes('Invalid login')) {
      log('❌ Authentication failed - check your email credentials');
    } else if (err.message.includes('timeout')) {
      log('❌ Connection to SMTP server timed out');
    } else if (err.message.includes('ECONNREFUSED')) {
      log('❌ Connection refused - is the SMTP server running?');
    }
    
    throw err;
  }
};

// Send password reset email
const sendPasswordResetEmail = async (email: string, resetUrl: string): Promise<SentMessageInfo> => {
  const subject = 'Password Reset Request';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Password Reset Request</h2>
      <p>You requested a password reset for your account. Click the button below to reset your password:</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" 
           style="display: inline-block; padding: 10px 20px; background-color: #4CAF50; 
                  color: white; text-decoration: none; border-radius: 4px;">
          Reset Password
        </a>
      </p>
      <p>If you didn't request this, you can safely ignore this email.</p>
      <p>This link will expire in 1 hour.</p>
      <hr>
      <p style="font-size: 12px; color: #666;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        ${resetUrl}
      </p>
    </div>
  `;

  return sendEmail({
    to: email,
    subject,
    html
  });
};

// Export all functions
export {
  sendEmail,
  sendPasswordResetEmail,
  initializeTransporter
};
