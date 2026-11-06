
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

module.exports = { notifyOrderEvent };
