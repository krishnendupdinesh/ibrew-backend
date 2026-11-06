// Register, login, logout, and admin password reset logic using MySQL.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getUserFromCookie, cacheUser } = require("../middleware/auth");

let activeAdminConfig = null;

function getAdminConfig() {
  if (!activeAdminConfig) {
    activeAdminConfig = {
      username: (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
      email: (process.env.ADMIN_EMAIL || "admin@ibrew.com").trim().toLowerCase(),
      password: process.env.ADMIN_PASSWORD || "Admin@12345",
      name: process.env.ADMIN_NAME || "ibrew Admin",
    };
  }
  return activeAdminConfig;
}

function serializeUser(user) {
  if (!user) return null;
  if (typeof user.toJSON === "function") return user.toJSON();
  return {
    id: String(user.id || user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    role: user.role || "customer",
  };
}

// Generates JWT login token and sets secure HTTP-only cookie.
function sendLoginCookie(res, user) {
  const clean = serializeUser(user);
  if (typeof cacheUser === "function") cacheUser(clean);

  const jwtSecret = process.env.JWT_SECRET || "ibrew-super-secret-jwt-key-for-auth";
  const token = jwt.sign(
    {
      id: clean.id,
      name: clean.name,
      email: clean.email,
      phone: clean.phone || "",
      role: clean.role || "customer",
    },
    jwtSecret,
    { expiresIn: "7d" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, phone, password } = req.body || {};

    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ error: "Enter your full name." });
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedName = String(name).trim().toLowerCase();
    const emailPrefix = normalizedEmail.split("@")[0];
    const adminCfg = getAdminConfig();

    // Prevent any customer from registering with the admin's username, email, or password
    if (
      normalizedEmail === adminCfg.email ||
      normalizedEmail === adminCfg.username ||
      emailPrefix === adminCfg.username ||
      normalizedName === adminCfg.username
    ) {
      return res
        .status(403)
        .json({ error: "This username or email is reserved and cannot be used." });
    }

    if (password === adminCfg.password || password === (process.env.ADMIN_PASSWORD || "Admin@12345")) {
      return res
        .status(403)
        .json({ error: "This password is not allowed. Please choose a different password." });
    }

    // Direct MySQL check for duplicate email
    const alreadyExists = await User.findOne({ email: normalizedEmail });
    if (alreadyExists) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    // Salt rounds: 10
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phone: phone ? String(phone).trim() : "",
      password: hashedPassword,
      role: "customer",
    });

    const clean = {
      id: String(user.id || user._id),
      name: user.name,
      email: user.email,
      phone: user.phone || "",
      role: user.role || "customer",
    };

    sendLoginCookie(res, clean);
    return res.status(201).json({ user: clean });
  } catch (error) {
    console.error("register error:", error.message);
    return res.status(500).json({ error: "Something went wrong. Try again." });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, username, identifier, password } = req.body || {};
    const rawId = String(email || username || identifier || "").trim().toLowerCase();

    if (!rawId || !password) {
      return res.status(400).json({ error: "Enter your username/email and password." });
    }

    const adminCfg = getAdminConfig();

    // 1. Admin authentication check
    // (A) Matches configured admin credentials
    if (
      (rawId === adminCfg.username || rawId === adminCfg.email) &&
      password === adminCfg.password
    ) {
      const adminUser = {
        id: "admin-default",
        name: adminCfg.name,
        email: adminCfg.email,
        username: adminCfg.username,
        phone: "",
        role: "admin",
      };
      sendLoginCookie(res, adminUser);
      return res.json({ user: adminUser });
    }

    // (B) Matches MySQL stored admin hash
    const adminInDb = await User.findOne({ email: adminCfg.email });
    if (
      (rawId === adminCfg.username || rawId === adminCfg.email) &&
      adminInDb &&
      adminInDb.role === "admin" &&
      (await bcrypt.compare(password, adminInDb.password))
    ) {
      const adminUser = {
        id: String(adminInDb.id),
        name: adminInDb.name || adminCfg.name,
        email: adminInDb.email,
        username: adminCfg.username,
        phone: adminInDb.phone || "",
        role: "admin",
      };
      sendLoginCookie(res, adminUser);
      return res.json({ user: adminUser });
    }

    // If identifier was admin username, fail early
    if (rawId === adminCfg.username) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // 2. Customer MySQL database lookup & bcrypt verification
    const userDoc = await User.findOne({ email: rawId });
    if (!userDoc) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const passwordIsRight = await bcrypt.compare(password, userDoc.password);
    if (!passwordIsRight) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const clean = {
      id: String(userDoc.id || userDoc._id),
      name: userDoc.name,
      email: userDoc.email,
      phone: userDoc.phone || "",
      role: userDoc.role || "customer",
    };

    sendLoginCookie(res, clean);
    return res.json({ user: clean });
  } catch (error) {
    console.error("login error:", error.message);
    return res.status(500).json({ error: "Something went wrong. Try again." });
  }
}

async function setupAdmin(req, res) {
  return res
    .status(403)
    .json({ error: "Admin uses credentials managed inside the Admin Dashboard." });
}

// GET /api/auth/reset-password (Admin only — returns admin identifier info without password)
async function getResetPasswordInfo(req, res) {
  const adminCfg = getAdminConfig();
  return res.json({
    credentials: {
      name: adminCfg.name,
      username: adminCfg.username,
      email: adminCfg.email,
    },
  });
}

// POST /api/auth/reset-password (Admin only — called from Admin Dashboard)
async function resetPassword(req, res) {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).trim().length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters." });
    }

    const adminCfg = getAdminConfig();
    adminCfg.password = String(newPassword).trim();
    process.env.ADMIN_PASSWORD = adminCfg.password;

    try {
      const hashedPassword = await bcrypt.hash(adminCfg.password, 10);
      await User.findOneAndUpdate(
        { email: adminCfg.email },
        { password: hashedPassword, role: "admin" },
        { upsert: false }
      );
    } catch {
      // ignore DB error
    }

    return res.json({
      credentials: {
        name: adminCfg.name,
        username: adminCfg.username,
        email: adminCfg.email,
      },
      message: "Admin password updated successfully!",
    });
  } catch (error) {
    console.error("resetPassword error:", error.message);
    return res.status(500).json({ error: "Could not reset password." });
  }
}

// GET /api/auth/me -> the logged-in user, or { user: null }
async function me(req, res) {
  const user = await getUserFromCookie(req);
  return res.json({ user: user || null });
}

// POST /api/auth/logout
function logout(req, res) {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res.json({ message: "Logged out" });
}

module.exports = {
  register,
  login,
  setupAdmin,
  getResetPasswordInfo,
  resetPassword,
  me,
  logout,
};
