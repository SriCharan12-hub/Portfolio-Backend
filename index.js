require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { Resend } = require("resend");
const Contact = require("./models/Contact");

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(
  cors({
    origin: ["https://portfolio-frontend-three-puce.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.use(express.json());

// Resend Configuration
const resend = new Resend(process.env.RESEND_API_KEY);

console.log("✅ Resend initialized");

// OTP Storage (in-memory with expiration)
const otpStore = new Map(); // { email: { otp, expiresAt } }
const verifiedEmails = new Map(); // { email: { name, email, subject, message, verifiedAt } }

// Helper function to generate OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to send OTP email
async function sendOTPEmail(email, otp) {
  const { data, error } = await resend.emails.send({
    from: "Portfolio <onboarding@resend.dev>",
    to: email,
    subject: "Your OTP for Portfolio Contact Form",
    html: `
      <h2>Email Verification</h2>
      <p>Thank you for reaching out! To verify your email, please use the following OTP:</p>
      <h1 style="font-size: 32px; letter-spacing: 5px; color: #a855f7;">${otp}</h1>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `,
  });

  if (error) {
    throw new Error(error.message);
  }
}

// Routes

// Send OTP endpoint
app.post("/api/send-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP
    otpStore.set(email, { otp, expiresAt });

    // Send OTP email
    await sendOTPEmail(email, otp);

    res.status(200).json({ message: "OTP sent successfully to your email!" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    res.status(500).json({ error: "Failed to send OTP. Please try again." });
  }
});

// Verify OTP endpoint
app.post("/api/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: "Email and OTP are required." });
    }

    // Check if OTP exists and is valid
    const otpData = otpStore.get(email);
    if (!otpData) {
      return res.status(400).json({ error: "OTP not found. Please request a new OTP." });
    }

    // Check if OTP has expired
    if (Date.now() > otpData.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ error: "OTP has expired. Please request a new OTP." });
    }

    // Check if OTP matches
    if (otpData.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP. Please try again." });
    }

    // Mark email as verified
    verifiedEmails.set(email, { verifiedAt: Date.now() });
    otpStore.delete(email);

    res.status(200).json({ message: "Email verified successfully!" });
  } catch (error) {
    console.error("Error verifying OTP:", error);
    res.status(500).json({ error: "OTP verification failed." });
  }
});

// Contact endpoint (only after OTP verification)
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body;

    // Basic validation
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "All fields are required." });
    }

    // Check if email is verified
    if (!verifiedEmails.has(email)) {
      return res.status(403).json({ error: "Please verify your email first." });
    }

    // Save to database
    const newContact = new Contact({
      name,
      email,
      subject,
      message,
    });

    await newContact.save();

    // Send email to your email address
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: "Portfolio Contact <onboarding@resend.dev>",
      to: process.env.APP_EMAIL,
      subject: `New Contact Form Submission: ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Message:</strong></p>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
    });

    if (emailError) {
      console.error("Error sending notification email:", emailError);
    }

    // Clear verification for this email
    verifiedEmails.delete(email);

    res.status(201).json({ message: "Message submitted successfully!" });
  } catch (error) {
    console.error("Error saving contact:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// MongoDB connection - Only start server after DB connects
mongoose
  .connect(process.env.MONGO_URI, {})
  .then(() => {
    console.log("Connected to MongoDB Successfully!");
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1); // Exit if DB fails to connect
  });
