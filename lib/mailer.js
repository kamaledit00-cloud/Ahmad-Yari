'use strict';
// MAIL ABSTRACTION. Only the "console" driver exists: it prints the message to the server log
// and does NOT deliver email. Before production, implement a real driver here (SMTP via nodemailer,
// or an email API such as Resend/Mailgun/SES) and set MAIL_DRIVER accordingly.
async function send({ to, subject, text }) {
  const driver = process.env.MAIL_DRIVER || 'console';
  if (driver === 'console') {
    console.log(`\n[mailer:console] Email NOT delivered (no mail service connected).\n  To: ${to}\n  Subject: ${subject}\n  ${text.replace(/\n/g, '\n  ')}\n`);
    return { delivered: false };
  }
  throw new Error(`MAIL_DRIVER "${driver}" is not implemented. Edit lib/mailer.js.`);
}
module.exports = { send };
