// Register, login, logout, and admin password reset logic.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getUserFromCookie, cacheUser } = require("../middleware/auth");

// Fast in-memory credential verification cache: sha256(identifier + ":" + password) -> user object
const verifiedLoginCache = new Map();

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

function makeAuthDigest(identifier, password) {
  return crypto
    .createHash("sha256")
    .update(`${identifier.trim().toLowerCase()}:${password}`)
    .digest("hex");
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

// Makes a login token and saves it in a cookie in the browser.
function sendLoginCookie(res, user) {
  const clean = serializeUser(user);
  cacheUser(clean);

  const token = jwt.sign(
    {
      id: clean.id,
      name: clean.name,
      email: clean.email,
      phone: clean.phone || "",
      role: clean.role || "customer",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

// POST /api/auth/register
async function register(req, res) {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: "Enter your full name." });
    }
    if (!email || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim().toLowerCase();
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

    const alreadyExists = await User.findOne({ email: normalizedEmail }).lean();
    if (alreadyExists) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const hashedPassword = await bcrypt.hash(password, 8);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: phone || "",
      password: hashedPassword,
      role: "customer",
    });

    const clean = serializeUser(user);
    verifiedLoginCache.set(makeAuthDigest(normalizedEmail, password), clean);
    sendLoginCookie(res, clean);
    res.status(201).json({ user: clean });
  } catch (error) {
    console.log("register error:", error.message);
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
}

// POST /api/auth/login
async function login(req, res) {
  try {
    const { email, username, identifier, password } = req.body;
    const rawId = String(email || username || identifier || "").trim().toLowerCase();

    if (!rawId || !password) {
      return res.status(400).json({ error: "Enter your username/email and password." });
    }

    const adminCfg = getAdminConfig();

    // 1. Admin check (accepts permanent username OR permanent email + active admin password)
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

    // Reject if someone tries to log into admin username/email with wrong password
    if (rawId === adminCfg.username || rawId === adminCfg.email) {
      return res.status(401).json({ error: "Wrong username/email or password." });
    }

    const digest = makeAuthDigest(rawId, password);

    // 2. Instant path: previously verified customer credentials in memory (< 1ms)
    if (verifiedLoginCache.has(digest)) {
      const cachedUser = verifiedLoginCache.get(digest);
      sendLoginCookie(res, cachedUser);
      return res.json({ user: cachedUser });
    }

    // 3. Database lookup + bcrypt verification for customer
    const userDoc = await User.findOne({ email: rawId }).lean();
    const passwordIsRight = userDoc && (await bcrypt.compare(password, userDoc.password));

    if (!passwordIsRight) {
      return res.status(401).json({ error: "Wrong username/email or password." });
    }

    const clean = {
      id: String(userDoc._id),
      name: userDoc.name,
      email: userDoc.email,
      phone: userDoc.phone || "",
      role: userDoc.role || "customer",
    };

    verifiedLoginCache.set(digest, clean);
    sendLoginCookie(res, clean);
    res.json({ user: clean });
  } catch (error) {
    console.log("login error:", error.message);
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
}

async function setupAdmin(req, res) {
  return res
    .status(403)
    .json({ error: "Admin uses credentials managed inside the Admin Dashboard." });
}

// GET /api/auth/reset-password (Admin only — returns current admin login details)
async function getResetPasswordInfo(req, res) {
  const adminCfg = getAdminConfig();
  return res.json({
    credentials: {
      name: adminCfg.name,
      username: adminCfg.username,
      email: adminCfg.email,
      password: adminCfg.password,
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
    verifiedLoginCache.clear();

    try {
      const hashedPassword = await bcrypt.hash(adminCfg.password, 8);
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
        password: adminCfg.password,
      },
      message: "Admin password updated successfully!",
    });
  } catch (error) {
    console.log("resetPassword error:", error.message);
    return res.status(500).json({ error: "Could not reset password." });
  }
}

// GET /api/auth/me -> the logged-in user, or { user: null }
async function me(req, res) {
  const user = await getUserFromCookie(req);
  res.json({ user: user || null });
}

// POST /api/auth/logout
function logout(req, res) {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
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
