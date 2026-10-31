export interface SendEmailOptions {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(options: SendEmailOptions): Promise<void>;
}
