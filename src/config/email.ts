import nodemailer from 'nodemailer';
import { config } from './env';

// Create a transporter object using the default SMTP transport
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: config.email.user,
    pass: config.email.pass,
  },
});

export const sendEmail = async (to: string, subject: string, text: string) => {
  try {
    const mailOptions = {
      from: `"Darajat" <${config.email.user}>`,
      to,
      subject,
      text,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
};

export const sendPasswordResetEmail = async (email: string, resetUrl: string) => {
  const subject = 'Password Reset Request';
  const text = `You requested a password reset. Please click the following link to reset your password: \n\n${resetUrl}\n\nThis link will expire in 15 minutes.\n\nIf you didn't request this, please ignore this email.`;
  
  return sendEmail(email, subject, text);
};
