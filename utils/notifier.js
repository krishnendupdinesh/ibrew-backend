
const nodemailer = require("nodemailer");

let transporter = null;

function getTransporter() {
    const {
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS,
    } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        return null;
    }

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(SMTP_PORT || 587),
            secure: Number(SMTP_PORT || 587) === 465,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });
    }

    return transporter;
}

const eventMessages = {
    ORDER_CONFIRMED: {
        subject: "Your iBrew order has been received",
        message: "Thank you for shopping with iBrew. Your order has been received successfully.",
    },
    ORDER_SHIPPED: {
        subject: "Your iBrew order has been shipped",
        message: "Good news! Your order is on its way.",
    },
    ORDER_DELIVERED: {
        subject: "Your iBrew order has been delivered",
        message: "Your order has been marked as delivered. Thank you for shopping with iBrew!",
    },
    ORDER_CANCELLED: {
        subject: "Your iBrew order has been cancelled",
        message: "Your order has been cancelled. Please contact our support team if you have questions.",
    },
};

async function notifyOrderEvent(order, event) {
    const mailer = getTransporter();

    if (!mailer) {
        console.log("Email notifications skipped: SMTP is not configured.");
        return;
    }

    const customerEmail = order?.customer?.email;

    if (!customerEmail) {
        console.log("Email notification skipped: customer email is missing.");
        return;
    }

    const eventInfo = eventMessages[event];

    if (!eventInfo) {
        console.warn("Unknown order notification event:", event);
        return;
    }

    const items = Array.isArray(order.items)
        ? order.items
            .map(
                (item) =>
                    `${item.name} (${item.size || "Standard"}) x ${item.quantity}`
            )
            .join("\n")
        : "Order details unavailable";

    const trackingInfo = order.trackingNumber
        ? `Tracking Number: ${order.trackingNumber}\nCourier: ${order.courierName || "Not specified"}`
        : "";

    await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: customerEmail,
        subject: eventInfo.subject,
        text: `
Hello ${order.customer.name || "Customer"},

${eventInfo.message}

Order ID: ${order.orderId || order.id}
Total: ₹${Number(order.total || 0).toFixed(2)}
Payment Status: ${order.paymentStatus || "unpaid"}

Items:
${items}

${trackingInfo}

Thank you,
iBrew Team
    `.trim(),
    });

    console.log(`Order notification sent: ${event} - ${order.orderId || order.id}`);
}

async function sendPasswordResetEmail(email, resetUrl, userName = "Customer") {
    const mailer = getTransporter();

    if (!mailer) {
        console.log(`[PASSWORD RESET] Email notifications skipped (SMTP not configured). Reset URL for ${email}: ${resetUrl}`);
        return;
    }

    try {
        await mailer.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: email,
            subject: "Reset your iBrew password",
            text: `
Hello ${userName},

We received a request to reset the password for your iBrew account.

Click the link below (or copy and paste it into your browser) to choose a new password:
${resetUrl}

This link is valid for 1 hour. If you did not request this, you can safely ignore this email.

Best regards,
The iBrew Team
            `.trim(),
            html: `
<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e5e5; border-radius: 8px;">
    <h2 style="color: #2b1810; margin-top: 0;">Reset Your iBrew Password</h2>
    <p>Hello ${userName},</p>
    <p>We received a request to reset your password. Click the button below to choose a new password. This link is valid for <strong>1 hour</strong>.</p>
    <p style="margin: 28px 0;">
        <a href="${resetUrl}" style="background-color: #78350f; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Reset Password
        </a>
    </p>
    <p style="color: #666; font-size: 13px;">Or copy and paste this link into your browser:</p>
    <p style="color: #888; font-size: 12px; word-break: break-all;"><a href="${resetUrl}">${resetUrl}</a></p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
    <p style="color: #999; font-size: 12px;">If you did not request a password reset, you can safely ignore this email.</p>
</div>
            `.trim(),
        });
        console.log(`Password reset email sent to ${email}`);
    } catch (err) {
        console.error("Failed to send password reset email:", err.message);
    }
}

module.exports = { notifyOrderEvent, sendPasswordResetEmail };
