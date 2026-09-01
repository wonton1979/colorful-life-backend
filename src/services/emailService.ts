import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config/index.js";

export type DispatchNotification = {
  customerEmail: string;
  orderId: number;
  shippingCarrier: string;
  trackingNumber?: string | null;
  dispatchedAt: Date;
};

type EmailSender = (notification: DispatchNotification) => Promise<void>;
export type VerificationEmail = { recipientEmail: string; verificationUrl: string };
type VerificationEmailSender = (email: VerificationEmail) => Promise<void>;

const sesClient = new SESClient({ region: config.AWS_REGION });

const sesEmailSender: EmailSender = async (notification) => {
  const tracking = notification.trackingNumber
    ? `Tracking number: ${notification.trackingNumber}`
    : "Tracking number: Not provided";
  await sesClient.send(new SendEmailCommand({
    Source: config.SES_FROM_EMAIL,
    Destination: { ToAddresses: [notification.customerEmail] },
    Message: {
      Subject: { Data: `Your order #${notification.orderId} has been dispatched`, Charset: "UTF-8" },
      Body: {
        Text: {
          Data: [
            `Your order #${notification.orderId} has been dispatched.`,
            `Carrier: ${notification.shippingCarrier}`,
            tracking,
            `Dispatched at: ${notification.dispatchedAt.toISOString()}`,
          ].join("\n"),
          Charset: "UTF-8",
        },
      },
    },
  }));
};

const sesVerificationEmailSender: VerificationEmailSender = async (email) => {
  await sesClient.send(new SendEmailCommand({
    Source: config.SES_FROM_EMAIL,
    Destination: { ToAddresses: [email.recipientEmail] },
    Message: {
      Subject: { Data: "Verify your Colorful Life account", Charset: "UTF-8" },
      Body: { Text: { Data: [
        "Please verify your Colorful Life account using the link below:",
        email.verificationUrl,
        "This link expires in 24 hours.",
      ].join("\n"), Charset: "UTF-8" } },
    },
  }));
};

let sender: EmailSender = sesEmailSender;
let verificationSender: VerificationEmailSender = sesVerificationEmailSender;

export function setDispatchNotificationSenderForTests(testSender: EmailSender): () => void {
  const previous = sender;
  sender = testSender;
  return () => {
    sender = previous;
  };
}

export function sendDispatchNotification(notification: DispatchNotification): Promise<void> {
  return sender(notification);
}

export function setVerificationEmailSenderForTests(testSender: VerificationEmailSender): () => void {
  const previous = verificationSender;
  verificationSender = testSender;
  return () => { verificationSender = previous; };
}

export function sendVerificationEmail(email: VerificationEmail): Promise<void> {
  return verificationSender(email);
}
