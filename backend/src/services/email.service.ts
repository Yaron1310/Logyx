import nodemailer from 'nodemailer';
import * as logger from "firebase-functions/logger";
import { emailTemplatesCollection } from '../db/collections.js';
import type { DBEmailTemplate } from '../types/index.js';

let transporter: nodemailer.Transporter | null = null;

const initializeTransporter = () => {
    if (transporter) {
        return;
    }

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !port || !user || !pass) {
        logger.error("SMTP configuration is missing from environment variables. Required: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS. Email functionality will be disabled.");
        transporter = null;
        return;
    }

    try {
        transporter = nodemailer.createTransport({
            host: host,
            port: port,
            secure: port === 465,
            auth: { user, pass },
        });

        transporter.verify((error) => {
            if (error) {
                logger.error('Nodemailer transporter verification failed. Emails will not be sent.', error);
                transporter = null;
            } else {
                logger.info('Nodemailer transporter is configured and ready to send emails.');
            }
        });
    } catch (error) {
        logger.error('Failed to create nodemailer transporter:', error);
        transporter = null;
    }
};

const isEmailServiceAvailable = (): boolean => transporter !== null;

const ensureTransporter = async () => {
    if (!transporter) {
        initializeTransporter();
        await new Promise(resolve => setTimeout(resolve, 100));
    }
};

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/**
 * Replace all {{variableName}} placeholders in a string with the provided values.
 * Unknown placeholders are left as-is.
 */
export const renderTemplate = (template: string, vars: Record<string, string>): string =>
    Object.entries(vars).reduce(
        (result, [key, value]) => result.split(`{{${key}}}`).join(value),
        template
    );

/**
 * Fetch a template from Firestore. Returns null if not found (caller falls back to hardcoded).
 */
const fetchTemplate = async (templateId: string): Promise<DBEmailTemplate | null> => {
    try {
        const doc = await emailTemplatesCollection.doc(templateId).get();
        if (!doc.exists) return null;
        return doc.data() as DBEmailTemplate;
    } catch (err) {
        logger.warn(`Could not fetch email template "${templateId}" from Firestore — using hardcoded fallback.`, err);
        return null;
    }
};

// ---------------------------------------------------------------------------
// Public: send a test email using a raw template document
// ---------------------------------------------------------------------------

export const sendTestEmailFromTemplate = async (
    template: DBEmailTemplate,
    toEmail: string
): Promise<{ success: boolean; error?: any }> => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;

    // Render with sample values so the admin sees real-ish content
    const sampleVars: Record<string, string> = {};
    for (const v of template.variables ?? []) {
        sampleVars[v] = `[${v}]`;
    }
    const subject = renderTemplate(template.subject, sampleVars);
    const html = renderTemplate(template.html, sampleVars);

    try {
        await transporter!.sendMail({ from: `"${fromName}" <${fromEmail}>`, to: toEmail, subject, html });
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send test email to ${toEmail}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------
// Email sending functions
// ---------------------------------------------------------------------------

export const sendAccountVerificationEmail = async (
    userEmail: string,
    userName: string,
    verificationLink: string,
    organizationName: string,
    inviteRole?: 'org_admin' | 'org_admin_notify' | 'org_manager',
    orgName?: string
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send verification email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    // The system-admin-issued "invite a new Organization Admin" email keeps app branding —
    // every other org-scoped email here is branded with the recipient's organization.
    const brandName = inviteRole === 'org_manager' ? (orgName || organizationName) : organizationName;
    const fromName = inviteRole === 'org_admin'
        ? (process.env.SMTP_FROM_NAME || 'Logyx')
        : (process.env.SMTP_FROM_NAME || brandName || 'Logyx');
    const fromEmail = process.env.SMTP_USER!;

    let templateId: string;
    let vars: Record<string, string>;

    if (inviteRole === 'org_admin_notify') {
        templateId = 'notify_organization_admin';
        vars = { userName, organizationName, loginLink: verificationLink };
    } else if (inviteRole === 'org_admin') {
        templateId = 'invite_organization_admin';
        vars = { userName, organizationName, verificationLink };
    } else if (inviteRole === 'org_manager') {
        templateId = 'invite_org_manager';
        vars = { userName, entityName: orgName || organizationName, verificationLink };
    } else {
        templateId = 'email_verification';
        vars = { userName, organizationName, verificationLink };
    }

    const tpl = await fetchTemplate(templateId);
    const subject = tpl ? renderTemplate(tpl.subject, vars) : buildFallbackVerificationSubject(inviteRole, organizationName, orgName);
    const html = tpl ? renderTemplate(tpl.html, vars) : buildFallbackVerificationHtml(userName, inviteRole, organizationName, orgName, verificationLink);

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `Hello ${userName}, please verify your email by visiting this link: ${verificationLink}`,
        });
        logger.info(`Verification email sent successfully to user: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send verification email to ${userEmail}`, error);
        return { success: false, error };
    }
};

const buildFallbackVerificationSubject = (inviteRole?: string, organizationName?: string, orgName?: string): string => {
    if (inviteRole === 'org_admin' || inviteRole === 'org_admin_notify') return `You've been invited as an Organization Admin for ${organizationName}`;
    if (inviteRole === 'org_manager') return `You've been invited as a WorkHub Admin for ${orgName || organizationName}`;
    return `Verify Your Email for ${organizationName}`;
};

const buildFallbackVerificationHtml = (
    userName: string, inviteRole?: string, organizationName?: string, orgName?: string, verificationLink?: string
): string => {
    let introLine: string;
    let ignoreNote: string;
    if (inviteRole === 'org_admin_notify') {
        introLine = `You've been added to <strong>${organizationName}</strong> as an Organization Admin. You can now log in and manage this organization.`;
        ignoreNote = 'If you did not expect this invitation, you can safely ignore this email.';
        return `<p>Hello ${userName},</p><p>${introLine}</p><p><a href="${verificationLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Login to ${organizationName}</a></p><p>${ignoreNote}</p><p>Thanks,<br/>The ${organizationName} Team</p>`;
    } else if (inviteRole === 'org_admin') {
        // System-admin-issued invitation for a brand-new Organization Admin — keeps app branding.
        introLine = `You've been invited to join <strong>${organizationName}</strong> as an Organization Admin. Please set up your account by verifying your email address below. This link is valid for 24 hours.`;
        ignoreNote = 'If you did not expect this invitation, you can safely ignore this email.';
        return `<p>Hello ${userName},</p><p>${introLine}</p><p><a href="${verificationLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Verify My Email</a></p><p>${ignoreNote}</p><p>Thanks,<br/>The Logyx Team</p>`;
    } else if (inviteRole === 'org_manager') {
        const entityName = orgName || organizationName;
        introLine = `You've been invited to join <strong>${entityName}</strong> as a WorkHub Admin. Please set up your account by verifying your email address below. This link is valid for 24 hours.`;
        ignoreNote = 'If you did not expect this invitation, you can safely ignore this email.';
        return `<p>Hello ${userName},</p><p>${introLine}</p><p><a href="${verificationLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Verify My Email</a></p><p>${ignoreNote}</p><p>Thanks,<br/>The ${entityName} Team</p>`;
    }
    introLine = 'Welcome! Before you can log in, please verify your email address by clicking the button below. This link is valid for 24 hours.';
    ignoreNote = 'If you did not create an account, you can safely ignore this email.';
    return `<p>Hello ${userName},</p><p>${introLine}</p><p><a href="${verificationLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Verify My Email</a></p><p>${ignoreNote}</p><p>Thanks,<br/>The ${organizationName} Team</p>`;
};

// ---------------------------------------------------------------------------

export const sendApprovalRequestEmail = async (
    managerEmail: string,
    newUser: { name: string; email: string },
    approvalLink: string
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send approval request to ${managerEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const vars = { newUserName: newUser.name, newUserEmail: newUser.email, approvalLink };

    const tpl = await fetchTemplate('approval_request');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `New User Registration Request: ${newUser.name}`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello,</p><p>A new user, <strong>${newUser.name}</strong> (<em>${newUser.email}</em>), has registered and is awaiting your approval.</p><p>Please review their request and click the link below to approve their account. This link will expire in 48 hours.</p><p><a href="${approvalLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Approve User</a></p><p>If you do not recognize this request, you can safely ignore this email.</p><p>Thanks,<br/>The Logyx Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: managerEmail,
            subject,
            html,
            text: `A new user, ${newUser.name} (${newUser.email}), has registered and is awaiting your approval. Please visit the following link to approve them: ${approvalLink}`,
        });
        logger.info(`Approval request email sent successfully to manager: ${managerEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send approval request email to ${managerEmail}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------

export const sendAccountApprovedEmail = async (userEmail: string, userName: string, loginLink: string) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send account approved email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const vars = { userName, loginLink };

    const tpl = await fetchTemplate('account_approved');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : 'Your Account Has Been Approved!';
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello ${userName},</p><p>Great news! Your account for Logyx has been approved by your organization's administrator.</p><p>You can now log in and start using the application.</p><p><a href="${loginLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Log In Now</a></p><p>Welcome aboard!</p><p>Thanks,<br/>The Logyx Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `Hello ${userName}, Your account has been approved. You can now log in at: ${loginLink}`,
        });
        logger.info(`Account approved email sent successfully to user: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send account approved email to ${userEmail}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------

export const sendPasswordResetEmail = async (
    userEmail: string,
    userName: string,
    resetLink: string,
    organizationName: string
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send password reset email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const vars = { userName, organizationName, resetLink };

    const tpl = await fetchTemplate('password_reset');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `Reset Your Password for ${organizationName}`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello ${userName},</p><p>We received a request to reset your password. Please click the button below to set a new password. This link is valid for 24 hours and can only be used once.</p><p><a href="${resetLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Reset Password</a></p><p>If you did not request a password reset, you can safely ignore this email.</p><p>Thanks,<br/>The ${organizationName} Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `Hello ${userName}, please reset your password by visiting this link: ${resetLink}`,
        });
        logger.info(`Password reset email sent successfully to user: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send password reset email to ${userEmail}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------

export const sendUsageNotificationEmail = async (
    adminEmails: string[],
    organizationName: string,
    usagePercentage: number
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send usage notification for ${organizationName} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }
    if (adminEmails.length === 0) {
        return { success: false, error: 'No admin emails provided.' };
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const warningLevel = usagePercentage >= 95 ? 'critical' : 'high';
    const vars = { organizationName, usagePercentage: String(usagePercentage), warningLevel };

    const tpl = await fetchTemplate('usage_alert');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `Usage Alert for ${organizationName}`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello,</p><p>This is a notification that your organization, <strong>${organizationName}</strong>, has reached ${usagePercentage}% of its monthly AI token usage limit.</p><p>This is a ${warningLevel} alert. If you reach 100%, new AI requests will be paused until the next billing cycle begins.</p><p>To prevent service interruption, you can increase your limit for the current month by visiting the Billing Settings page in your admin dashboard.</p><p>Thanks,<br/>The Logyx Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: adminEmails.join(','),
            subject,
            html,
            text: `Your organization, ${organizationName}, has reached ${usagePercentage}% of its monthly AI token usage limit. Please visit your dashboard to manage your billing.`,
        });
        logger.info(`Usage notification email sent successfully to admins of ${organizationName}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send usage notification email for ${organizationName}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------

export const sendWelcomeEmail = async (userEmail: string, userName: string, organizationName = 'Logyx') => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send welcome email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

    const vars = {
        userName,
        organizationName,
        dashboardLink: `${frontendUrl}/login`,
        currentYear: String(new Date().getFullYear()),
    };

    const tpl = await fetchTemplate('welcome');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `Welcome to ${organizationName}, ${userName}!`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : buildFallbackWelcomeHtml(userName, organizationName, frontendUrl);

    try {
        const mailOptions: nodemailer.SendMailOptions = {
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `Welcome to ${organizationName}, ${userName}! Your account is now active. Log in at ${frontendUrl}/login`,
        };
        await transporter!.sendMail(mailOptions);
        logger.info(`Welcome email sent successfully to user: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send welcome email to ${userEmail}`, error);
        return { success: false, error };
    }
};

const buildFallbackWelcomeHtml = (userName: string, organizationName: string, frontendUrl: string): string => `
    <!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;line-height:1.6;color:#333;margin:0;padding:0}
    .container{max-width:600px;margin:20px auto;padding:20px;border:1px solid #e5e7eb;border-radius:8px}
    .header{display:flex;align-items:center;justify-content:center;margin-bottom:30px;gap:10px}
    .welcome-text{font-size:24px;font-weight:bold;color:#1f2937;margin:0}
    .content{padding:0 20px}
    .footer{text-align:center;margin-top:30px;font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:20px}
    .button-container{text-align:center;margin:30px 0}
    .button{background-color:#2563eb;color:#ffffff!important;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block}
    </style></head><body><div class="container">
    <div class="header"><span class="welcome-text">Welcome to ${organizationName}</span></div>
    <div class="content"><p>Hello ${userName},</p>
    <p>We're excited to have you join us! ${organizationName} is your new organization for business management.</p>
    <p>Your account is now fully active. You can start exploring your boards, items, and dashboards right away.</p>
    <div class="button-container"><a href="${frontendUrl}/login" class="button">Go to Dashboard</a></div>
    <p>If you have any questions or need a hand getting started, we're here to help.</p>
    <p>Best regards,<br/>The ${organizationName} Team</p></div>
    <div class="footer">&copy; ${new Date().getFullYear()} ${organizationName}. All rights reserved.</div>
    </div></body></html>`;

// ---------------------------------------------------------------------------

export const sendNewsletterEmail = async (
    to: string,
    subject: string,
    htmlContent: string,
    organizationName: string
): Promise<{ success: boolean; error?: any }> => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send newsletter email to ${to} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || organizationName;
    const fromEmail = process.env.SMTP_USER!;

    try {
        await transporter!.sendMail({ from: `"${fromName}" <${fromEmail}>`, to, subject, html: htmlContent, text: `Newsletter from ${organizationName}: ${subject}` });
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send newsletter email to ${to}`, error);
        return { success: false, error };
    }
};

// ---------------------------------------------------------------------------

export const retryEmailServiceInitialization = () => {
    logger.info('Retrying email service initialization...');
    transporter = null;
    initializeTransporter();
};

// ---------------------------------------------------------------------------

export const sendChatMentionEmail = async (
    toEmail: string,
    toName: string,
    senderName: string,
    itemName: string,
    messageText: string,
    reason: 'mention' | 'assigned',
    organizationName = 'Logyx',
): Promise<void> => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) return;

    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const subject = reason === 'mention'
        ? `${senderName} mentioned you in "${itemName}"`
        : `New message in "${itemName}" — you are assigned`;
    const intro = reason === 'mention'
        ? `<strong>${senderName}</strong> mentioned you in <strong>${itemName}</strong>:`
        : `There is a new chat message in an item assigned to you — <strong>${itemName}</strong>:`;
    const html = `<p>Hello ${toName},</p>
<p>${intro}</p>
<blockquote style="border-left:3px solid #6366f1;padding:8px 16px;margin:12px 0;background:#f5f3ff;border-radius:4px;color:#374151;white-space:pre-wrap;">
  ${messageText.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}
</blockquote>
<p>Thanks,<br/>The ${organizationName} Team</p>`;

    try {
        await transporter!.sendMail({ from: `"${fromName}" <${fromEmail}>`, to: toEmail, subject, html });
    } catch (error) {
        logger.error(`Failed to send chat mention email to ${toEmail}`, error);
    }
};

// ---------------------------------------------------------------------------

export const sendItemAssignmentEmail = async (
    toEmail: string,
    toName: string,
    actorName: string,
    itemName: string,
    boardName: string,
    organizationName = 'Logyx',
): Promise<void> => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) return;

    const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const subject = `You've been assigned to "${itemName}"`;
    const onBoard = boardName ? ` on <strong>${esc(boardName)}</strong>` : '';
    const html = `<p>Hello ${esc(toName)},</p>
<p><strong>${esc(actorName)}</strong> assigned you to <strong>${esc(itemName)}</strong>${onBoard}.</p>
<p>Thanks,<br/>The ${esc(organizationName)} Team</p>`;

    try {
        await transporter!.sendMail({ from: `"${fromName}" <${fromEmail}>`, to: toEmail, subject, html });
    } catch (error) {
        logger.error(`Failed to send assignment email to ${toEmail}`, error);
    }
};

// ---------------------------------------------------------------------------

export const sendBulkAssignmentEmail = async (
    toEmail: string,
    toName: string,
    actorName: string,
    groupName: string,
    boardName: string,
    itemCount: number,
    organizationName = 'Logyx',
): Promise<void> => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) return;

    const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const subject = `You've been assigned to "${groupName}"`;
    const onBoard = boardName ? ` on <strong>${esc(boardName)}</strong>` : '';
    const itemsText = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    const html = `<p>Hello ${esc(toName)},</p>
<p><strong>${esc(actorName)}</strong> assigned you to ${itemsText} in group <strong>${esc(groupName)}</strong>${onBoard}.</p>
<p>Thanks,<br/>The ${esc(organizationName)} Team</p>`;

    try {
        await transporter!.sendMail({ from: `"${fromName}" <${fromEmail}>`, to: toEmail, subject, html });
    } catch (error) {
        logger.error(`Failed to send bulk assignment email to ${toEmail}`, error);
    }
};

// ---------------------------------------------------------------------------

export const sendUserInvitationEmail = async (
    userEmail: string,
    orgName: string,
    organizationName: string,
    registrationLink: string
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send invitation email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || orgName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const partOfText = orgName !== organizationName
        ? ` (part of <strong>${organizationName}</strong>)`
        : '';
    const vars = { orgName, organizationName, partOfText, registrationLink };

    const tpl = await fetchTemplate('user_invitation');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `You've been invited to join ${orgName}`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello,</p><p>You've been invited to join <strong>${orgName}</strong>${partOfText}.</p><p>To get started, please create your account using the button below. Make sure to sign up with this email address.</p><p><a href="${registrationLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">Create My Account</a></p><p>If you did not expect this invitation, you can safely ignore this email.</p><p>Thanks,<br/>The ${orgName} Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `You've been invited to join ${orgName}. Create your account at: ${registrationLink}`,
        });
        logger.info(`Invitation email sent successfully to: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send invitation email to ${userEmail}`, error);
        return { success: false, error };
    }
};

export const sendBoardViewInviteEmail = async (
    userEmail: string,
    boardName: string,
    inviterName: string,
    viewLink: string,
    expirationDays: number,
    organizationName = 'Logyx',
) => {
    await ensureTransporter();
    if (!isEmailServiceAvailable()) {
        logger.error(`Could not send board view invite email to ${userEmail} because email service is not initialized.`);
        return { success: false, error: 'Email service not available' };
    }

    const fromName = process.env.SMTP_FROM_NAME || organizationName || 'Logyx';
    const fromEmail = process.env.SMTP_USER!;
    const expiresText = `${expirationDays} day${expirationDays === 1 ? '' : 's'}`;
    const vars = { boardName, inviterName, viewLink, expiresText, organizationName };

    const tpl = await fetchTemplate('board_view_invite');
    const subject = tpl ? renderTemplate(tpl.subject, vars) : `${inviterName} shared the board "${boardName}" with you`;
    const html = tpl
        ? renderTemplate(tpl.html, vars)
        : `<p>Hello,</p><p><strong>${inviterName}</strong> shared a read-only view of the board <strong>${boardName}</strong> with you on ${organizationName}.</p><p>No account or login is required.</p><p><a href="${viewLink}" style="background-color:#2563eb;color:white;padding:10px 15px;text-decoration:none;border-radius:5px;">View Board</a></p><p>This link expires in ${expiresText} and only works for this email invitation.</p><p>If you did not expect this, you can safely ignore this email.</p><p>Thanks,<br/>The ${organizationName} Team</p>`;

    try {
        await transporter!.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: userEmail,
            subject,
            html,
            text: `${inviterName} shared the board "${boardName}" with you on ${organizationName}. View it (no login required, link expires in ${expiresText}): ${viewLink}`,
        });
        logger.info(`Board view invite email sent successfully to: ${userEmail}`);
        return { success: true };
    } catch (error) {
        logger.error(`Failed to send board view invite email to ${userEmail}`, error);
        return { success: false, error };
    }
};

