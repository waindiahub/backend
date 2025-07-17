import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export const sendEmail = async (options: EmailOptions) => {
  try {
    await transporter.sendMail({
      from: options.from || process.env.SMTP_USER,
      to: options.to,
      subject: options.subject,
      html: options.html
    });
  } catch (error) {
    console.error('Email sending failed:', error);
    throw error;
  }
};
