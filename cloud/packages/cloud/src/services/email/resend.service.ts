import { Resend } from "resend";

/**
 * Email service using Resend API for sending transactional emails
 */
export class ResendEmailService {
  private resend: Resend;
  private defaultSender: string;

  /**
   * Initializes the Resend email service
   * @throws Error if RESEND_API_KEY is not defined in environment variables
   */
  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not defined in environment variables");
    }
    this.resend = new Resend(apiKey);
    this.defaultSender =
      process.env.EMAIL_SENDER || "Mentra <noreply@mentra.glass>";
  }

  /**
   * Sends an app approval notification email to the developer/organization contact.
   * Includes optional review notes from the admin.
   */
  async sendFeedback(
    userEmail: string,
    feedback: string,
    to: string[],
  ): Promise<{ id?: string; error?: any }> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: to,
        cc: [userEmail],
        subject: `New feedback from: ${userEmail}`,
        html: `<p>${feedback}</p>`,
      });

      if (error) {
        console.error("[resend.service] Failed to send feedback email:", error);
        return { error };
      }

      return { id: data?.id };
    } catch (error) {
      console.error("[resend.service] Error sending approval email:", error);
      return { error };
    }
  }

  /**
   * Sends an app approval notification email to the developer/organization contact.
   * Includes optional review notes from the admin.
   */
  async sendAppApprovalNotification(
    recipientEmail: string,
    appName: string,
    packageName: string,
    notes?: string,
  ): Promise<{ id?: string; error?: any }> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: [recipientEmail],
        subject: `Your MentraOS app "${appName}" was approved`,
        html: this.generateApprovalEmailHtml(appName, packageName, notes),
      });

      if (error) {
        console.error("[resend.service] Failed to send approval email:", error);
        return { error };
      }

      return { id: data?.id };
    } catch (error) {
      console.error("[resend.service] Error sending approval email:", error);
      return { error };
    }
  }

  /**
   * Sends an app rejection notification email to the developer/organization contact.
   * Includes required review notes from the admin.
   */
  async sendAppRejectionNotification(
    recipientEmail: string,
    appName: string,
    packageName: string,
    notes: string,
    reviewerEmail?: string,
  ): Promise<{ id?: string; error?: any }> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: [recipientEmail],
        cc: reviewerEmail ? [reviewerEmail] : undefined,
        subject: `Your MentraOS app "${appName}" was not approved`,
        html: this.generateRejectionEmailHtml(
          appName,
          packageName,
          notes,
          reviewerEmail,
        ),
      });

      if (error) {
        console.error(
          "[resend.service] Failed to send rejection email:",
          error,
        );
        return { error };
      }

      return { id: data?.id };
    } catch (error) {
      console.error("[resend.service] Error sending rejection email:", error);
      return { error };
    }
  }

  /**
   * Sends an app outage notification email to a developer/organization contact.
   */
  async sendAppOutageNotification(
    recipientEmail: string,
    appName: string,
    packageName: string,
    publicUrl?: string,
  ): Promise<{ id?: string; error?: any }> {
    try {
      const healthUrl = publicUrl
        ? `${publicUrl.replace(/\/$/, "")}/health`
        : undefined;
      const html = `
        <!DOCTYPE html>
        <html>
          <head><meta charset="utf-8" /><title>${appName} appears offline</title></head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;">
            <h2>Your app ${appName} appears to be offline</h2>
            <p>We detected that your app <strong>${appName}</strong> (${packageName}) is currently not responding as of ${new Date().toISOString()}.</p>
            ${healthUrl ? `<p>Please check your server's health endpoint: <a href="${healthUrl}">${healthUrl}</a></p>` : ""}
            <p>We will send at most one notification every 24 hours while the app remains offline.</p>
            <p>— MentraOS</p>
          </body>
        </html>
      `;

      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: [recipientEmail],
        subject: `[Alert] ${appName} appears to be down`,
        html,
      });

      if (error) {
        console.error("[resend.service] Failed to send outage email:", error);
        return { error };
      }

      return { id: data?.id };
    } catch (error) {
      console.error("[resend.service] Error sending outage email:", error);
      return { error };
    }
  }

  /**
   * Sends an organization invitation email
   * @param recipientEmail - Email address of the invitee
   * @param inviterName - Name of the person sending the invitation
   * @param organizationName - Name of the organization
   * @param inviteToken - JWT token for accepting the invitation
   * @param role - Role assigned to the invitee
   * @returns Promise with the result of the email sending operation
   */
  async sendOrganizationInvite(
    recipientEmail: string,
    inviterName: string,
    organizationName: string,
    inviteToken: string,
    role: string,
  ): Promise<{ id?: string; error?: any }> {
    const inviteUrl = `${process.env.DEV_CONSOLE_FRONTEND_URL || "https://console.mentra.glass"}/invite/accept?token=${inviteToken}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: [recipientEmail],
        subject: `You've been invited to join ${organizationName} on Mentra`,
        html: this.generateInviteEmailHtml(
          inviterName,
          organizationName,
          inviteUrl,
          role,
        ),
      });

      if (error) {
        console.error(
          "[resend.service] Failed to send invitation email:",
          error,
        );
        return { error };
      }

      return { id: data?.id };
    } catch (error) {
      console.error("[resend.service] Error sending invitation email:", error);
      return { error };
    }
  }

  /**
   * Generates HTML content for organization invitation emails
   * @param inviterName - Name of the person sending the invitation
   * @param organizationName - Name of the organization
   * @param inviteUrl - URL for accepting the invitation
   * @param role - Role assigned to the invitee
   * @returns HTML string for the email
   * @private
   */
  private generateInviteEmailHtml(
    inviterName: string,
    organizationName: string,
    inviteUrl: string,
    role: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Organization Invitation</title>
          <style>
            /* Base styles */
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              background-color: #f6f7f9;
              margin: 0;
              padding: 0;
            }

            /* Container */
            .container {
              max-width: 600px;
              margin: 0 auto;
              background-color: #ffffff;
              border-radius: 8px;
              border: 1px solid #e1e4e8;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
              overflow: hidden;
            }

            /* Header */
            .header {
              background-color: #3a5fcd;
              color: white;
              text-align: center;
              padding: 30px 20px;
            }

            .header h1 {
              margin: 0;
              font-size: 28px;
              font-weight: 600;
              letter-spacing: 0.5px;
            }

            /* Content */
            .content {
              padding: 30px;
            }

            /* Typography */
            p {
              margin: 16px 0;
              font-size: 16px;
            }

            strong {
              font-weight: 600;
              color: #222;
            }

            /* Button */
            .button-container {
              text-align: center;
              margin: 35px 0;
            }

            .button {
              display: inline-block;
              background-color:rgb(206, 216, 248);
              color: #000;
              text-decoration: none;
              padding: 14px 32px;
              border-radius: 6px;
              font-weight: 600;
              font-size: 16px;
              letter-spacing: 0.3px;
              box-shadow: 0 4px 10px rgba(58, 95, 205, 0.3);
              transition: all 0.3s ease;
            }

            .button:hover {
              background-color:rgb(159, 177, 232));
            }

            /* Footer */
            .footer {
              background-color: #f6f7f9;
              padding: 20px;
              text-align: center;
              border-top: 1px solid #e1e4e8;
              margin-top: 20px;
              font-size: 13px;
              color: #666;
            }

            /* Utility */
            .highlight {
              color: #3a5fcd;
            }

            .note {
              font-size: 14px;
              color: #666;
              font-style: italic;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>You've Been Invited to an Organization on Mentra!</h1>
            </div>

            <div class="content">
              <p>Hello,</p>

              <p>
                <strong>${inviterName}</strong> has invited you to join
                <strong class="highlight">${organizationName}</strong>
                as a <strong>${role}</strong> on the Mentra Developer Console.
              </p>

              <p>As a member of this organization, you'll have access to all the applications and resources shared by the team.</p>

              <div class="button-container">
                <a href="${inviteUrl}" class="button">Accept Invitation</a>
              </div>

              <p class="note">This invitation link will expire in 7 days.</p>

              <p>If you didn't expect this invitation or have any questions, please contact ${inviterName}.</p>
            </div>

            <div class="footer">
              &copy; ${new Date().getFullYear()} Mentra Labs.
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Sends an account deletion verification email
   * @param recipientEmail - Email address of the user requesting deletion
   * @param verificationCode - 6-character verification code
   * @returns Promise with the result of the email sending operation
   */
  async sendAccountDeletionVerification(
    recipientEmail: string,
    verificationCode: string,
  ): Promise<{ id?: string; error?: any }> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.defaultSender,
        to: [recipientEmail],
        subject: "Confirm Account Deletion - Mentra",
        html: this.generateDeletionEmailHtml(verificationCode),
      });

      if (error) {
        console.error(
          "[resend.service] Failed to send deletion verification email:",
          error,
        );
        return { error };
      }

      console.log(
        "[resend.service] Deletion verification email sent successfully:",
        data?.id,
      );
      return { id: data?.id };
    } catch (error) {
      console.error(
        "[resend.service] Error sending deletion verification email:",
        error,
      );
      return { error };
    }
  }

  /**
   * Generates HTML content for account deletion verification email
   * @param verificationCode - 6-character verification code
   * @returns HTML string for the email body
   */
  private generateDeletionEmailHtml(verificationCode: string): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Confirm Account Deletion - Mentra</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f8f9fa;
            }

            .container {
              background-color: white;
              border-radius: 12px;
              border: 1px solid #e1e4e8;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
              overflow: hidden;
            }

            .header {
              background-color: #dc3545;
              color: white;
              text-align: center;
              padding: 30px 20px;
            }

            .header h1 {
              margin: 0;
              font-size: 28px;
              font-weight: 600;
              letter-spacing: 0.5px;
            }

            .content {
              padding: 30px;
            }

            p {
              margin: 16px 0;
              font-size: 16px;
            }

            .verification-code {
              background-color: #f8f9fa;
              border: 2px solid #dc3545;
              border-radius: 8px;
              text-align: center;
              padding: 20px;
              margin: 25px 0;
              font-size: 32px;
              font-weight: bold;
              color: #dc3545;
              letter-spacing: 4px;
              font-family: monospace;
            }

            .warning {
              background-color: #fff3cd;
              border: 1px solid #ffeaa7;
              border-radius: 6px;
              padding: 15px;
              margin: 20px 0;
              color: #856404;
            }

            .footer {
              background-color: #f8f9fa;
              padding: 20px;
              text-align: center;
              font-size: 14px;
              color: #6c757d;
              border-top: 1px solid #e1e4e8;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🗑️ Account Deletion Request</h1>
            </div>

            <div class="content">
              <p><strong>You have requested to delete your Mentra account.</strong></p>

              <div class="warning">
                <strong>⚠️ Warning:</strong> This action is permanent and cannot be undone. All your data, including photos, settings, and app configurations will be permanently deleted.
              </div>

              <p>To confirm the deletion of your account, please use this verification code:</p>

              <div class="verification-code">
                ${verificationCode}
              </div>

              <p><strong>This code will expire in 24 hours.</strong></p>

              <p>If you did not request this account deletion, please ignore this email. Your account will remain safe and no action will be taken.</p>

              <p>If you're having issues with Mentra and considering deletion, please reach out to our support team at <a href="mailto:support@mentra.glass">support@mentra.glass</a> - we'd love to help!</p>
            </div>

            <div class="footer">
              &copy; ${new Date().getFullYear()} Mentra Labs.
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generates HTML for approval notification.
   */
  private generateApprovalEmailHtml(
    appName: string,
    packageName: string,
    notes?: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>MentraOS App Approved</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; background-color: #f6f7f9; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
            .header { background-color: #16a34a; color: #fff; padding: 24px; text-align: center; }
            .content { padding: 24px; }
            .meta { color: #555; font-size: 14px; margin-top: 8px; }
            .notes { background: #f1f5f9; border: 1px solid #e2e8f0; padding: 16px; border-radius: 6px; white-space: pre-wrap; }
            .footer { background: #f8fafc; padding: 16px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Your app was approved</h2>
            </div>
            <div class="content">
              <p>Great news! Your app <strong>${appName}</strong> (<code>${packageName}</code>) has been approved for publishing on MentraOS.</p>
              ${notes && notes.trim() ? `<div class="meta">Review notes from our team:</div><div class="notes">${notes}</div>` : ""}
              <p>Your app will now appear in the MentraOS app store and be available to users.</p>
            </div>
            <div class="footer">&copy; ${new Date().getFullYear()} Mentra Labs</div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Generates HTML for rejection notification.
   */
  private generateRejectionEmailHtml(
    appName: string,
    packageName: string,
    notes: string,
    reviewerEmail?: string,
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>MentraOS App Not Approved</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; line-height: 1.6; color: #333; background-color: #f6f7f9; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 20px auto; background: #fff; border: 1px solid #e1e4e8; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
            .header { background-color: #dc2626; color: #fff; padding: 24px; text-align: center; }
            .content { padding: 24px; }
            .notes { background: #fff7ed; border: 1px solid #fed7aa; padding: 16px; border-radius: 6px; white-space: pre-wrap; }
            .footer { background: #f8fafc; padding: 16px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2>Your app was not approved</h2>
            </div>
            <div class="content">
              <p>Your app <strong>${appName}</strong> (<code>${packageName}</code>) was not approved at this time, with the following feedback:</p>
              <div class="notes">${notes || "No notes provided."}</div>
              <p>You can address the items above and resubmit the app when ready.</p>
              ${reviewerEmail ? `<p class="meta">If you have questions about this decision, you can reply to <a href="mailto:${reviewerEmail}">${reviewerEmail}</a>.</p>` : ""}
            </div>
            <div class="footer">&copy; ${new Date().getFullYear()} Mentra Labs</div>
          </div>
        </body>
      </html>
    `;
  }
}

// Create singleton instance
export const emailService = new ResendEmailService();
