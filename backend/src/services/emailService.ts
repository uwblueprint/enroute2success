import 'dotenv/config';
import nodemailer from 'nodemailer';

const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM ?? smtpUser ?? 'no-reply@enroute2success.org';

const transporter =
  smtpUser && smtpPass
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: { user: smtpUser, pass: smtpPass },
      })
    : null;

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  if (!transporter) {
    console.warn(
      `[emailService] SMTP_USER/SMTP_PASS not set — skipping email to "${input.to}" ` +
        `with subject "${input.subject}".`
    );
    return;
  }

  await transporter.sendMail({
    from: emailFrom,
    to: input.to,
    subject: input.subject,
    html: input.html,
  });
}

// NOTE: don't worry abt this linking working for now. that's a frontend issue :D
export async function sendSetPasswordEmail(to: string, setPasswordUrl: string): Promise<void> {
  await sendEmail({
    to,
    subject: 'Set your Enroute2Success password',
    html: `
      <p>Welcome to Enroute2Success!</p>
      <p>Click the link below to set your password and finish setting up your account:</p>
      <p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p>
      <p>This link will expire soon, so please use it right away.</p>
    `,
  });
}
