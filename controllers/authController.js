// Register, login, logout, and admin password reset logic using MySQL.
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getPool } = require("../config/mysql");
const { getUserFromCookie, cacheUser } = require("../middleware/auth");

function safeCompareStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

let activeAdminConfig = null;

function getAdminConfig() {
  if (!activeAdminConfig) {
    activeAdminConfig = {
      username: (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
      email: (process.env.ADMIN_EMAIL || "admin@ibrew.com").trim().toLowerCase(),
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

// Generates JWT login token and sets secure HTTP-only cookies.
// Customers receive a permanent 10-year refresh token in MySQL + permanent cookie.
// Admins receive a standard 7-day session.
async function sendLoginCookie(res, user, req = null) {
  const clean = serializeUser(user);
  if (typeof cacheUser === "function") cacheUser(clean);

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || !jwtSecret.trim()) {
    throw new Error("JWT_SECRET environment variable is missing.");
  }

  const isCustomer = clean.role === "customer";
  const isProd = process.env.NODE_ENV === "production";

  // Access token: 30 days for customer; 2 hours for admin
  const accessExpiry = isCustomer ? "30d" : "2h";
  const accessMaxAge = isCustomer
    ? 30 * 24 * 60 * 60 * 1000 // 30 days
    : 2 * 60 * 60 * 1000; // 2 hours

  const token = jwt.sign(
    {
      id: clean.id,
      name: clean.name,
      email: clean.email,
      phone: clean.phone || "",
      role: clean.role || "customer",
    },
    jwtSecret,
    { expiresIn: accessExpiry }
  );

  // Access token cookie
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
    maxAge: accessMaxAge,
  });

  // Long-lived persistent refresh token (10 years for permanent customer login)
  try {
    const rawRefreshToken = crypto.randomBytes(40).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawRefreshToken).digest("hex");
    const pool = getPool();
    const userAgent = req?.headers?.["user-agent"] ? String(req.headers["user-agent"]).substring(0, 500) : "";
    const ipAddress = req?.ip || req?.socket?.remoteAddress || "";

    // 10 years in days (~3650 days) for indefinite permanent login
    const refreshMaxAge = isCustomer
      ? 10 * 365 * 24 * 60 * 60 * 1000 // 10 years
      : 7 * 24 * 60 * 60 * 1000; // 7 days

    const intervalSql = isCustomer ? "INTERVAL 10 YEAR" : "INTERVAL 7 DAY";

    if (clean.id && clean.id !== "admin-default") {
      await pool.execute(
        `INSERT INTO \`refresh_tokens\` (\`user_id\`, \`token_hash\`, \`expires_at\`, \`revoked\`, \`user_agent\`, \`ip_address\`)
         VALUES (?, ?, DATE_ADD(NOW(), ${intervalSql}), 0, ?, ?)`,
        [Number(clean.id), tokenHash, userAgent, ipAddress]
      );
    }

    res.cookie("refreshToken", rawRefreshToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      path: "/",
      maxAge: refreshMaxAge,
    });

    return { token, refreshToken: rawRefreshToken };
  } catch (err) {
    console.error("sendLoginCookie refresh token error:", err.message);
    return { token };
  }
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

    // Prevent any customer from registering with the admin's username or email
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

    await sendLoginCookie(res, clean, req);
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
    const isAdminIdentifier = rawId === adminCfg.username || rawId === adminCfg.email;
    if (isAdminIdentifier) {
      const adminInDb = await User.findOne({ email: adminCfg.email });
      let adminAuthenticated = false;

      if (adminInDb && adminInDb.role === "admin" && adminInDb.password) {
        adminAuthenticated = await bcrypt.compare(password, adminInDb.password);
      } else if (process.env.ADMIN_PASSWORD && safeCompareStrings(password, process.env.ADMIN_PASSWORD)) {
        // Bootstrap flow: hash and persist to database
        adminAuthenticated = true;
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.findOneAndUpdate(
          { email: adminCfg.email },
          { name: adminCfg.name, email: adminCfg.email, password: hashedPassword, role: "admin" },
          { upsert: true }
        );
      }

      if (adminAuthenticated) {
        const adminUser = {
          id: adminInDb ? String(adminInDb.id) : "admin-default",
          name: adminInDb?.name || adminCfg.name,
          email: adminCfg.email,
          username: adminCfg.username,
          phone: adminInDb?.phone || "",
          role: "admin",
        };
        await sendLoginCookie(res, adminUser, req);
        return res.json({ user: adminUser });
      }

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

    await sendLoginCookie(res, clean, req);
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
    const hashedPassword = await bcrypt.hash(String(newPassword).trim(), 10);

    await User.findOneAndUpdate(
      { email: adminCfg.email },
      { password: hashedPassword, role: "admin" },
      { upsert: true }
    );

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

// POST /api/auth/refresh (Exchange valid refresh token for a new access token & rotate refresh token)
async function refreshSession(req, res) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!rawRefreshToken || typeof rawRefreshToken !== "string") {
      return res.status(401).json({ error: "No refresh token provided." });
    }

    const tokenHash = crypto.createHash("sha256").update(rawRefreshToken).digest("hex");
    const pool = getPool();

    // Check refresh token in database
    const [rows] = await pool.execute(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, u.id as uid, u.name, u.email, u.phone, u.role
       FROM \`refresh_tokens\` rt
       JOIN \`users\` u ON rt.user_id = u.id
       WHERE rt.token_hash = ? LIMIT 1`,
      [tokenHash]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: "Invalid refresh token." });
    }

    const record = rows[0];

    // If token was revoked, revoke all tokens for this user as a security measure (token reuse detection)
    if (record.revoked) {
      await pool.execute(
        "UPDATE `refresh_tokens` SET `revoked` = 1 WHERE `user_id` = ?",
        [record.user_id]
      );
      return res.status(401).json({ error: "Refresh token has been revoked." });
    }

    // Check expiry
    if (new Date(record.expires_at).getTime() < Date.now()) {
      return res.status(401).json({ error: "Refresh token has expired." });
    }

    // Revoke old refresh token (rotation)
    await pool.execute(
      "UPDATE `refresh_tokens` SET `revoked` = 1 WHERE `id` = ?",
      [record.id]
    );

    const user = {
      id: String(record.uid),
      name: record.name,
      email: record.email,
      phone: record.phone || "",
      role: record.role || "customer",
    };

    // Issue new access token + new refresh token
    await sendLoginCookie(res, user, req);
    return res.json({ user });
  } catch (err) {
    console.error("refreshSession error:", err.message);
    return res.status(500).json({ error: "Failed to refresh session." });
  }
}

// GET /api/auth/me -> the logged-in user, or { user: null }
async function me(req, res) {
  const user = await getUserFromCookie(req, res);
  return res.json({ user: user || null });
}

// POST /api/auth/logout
async function logout(req, res) {
  try {
    const rawRefreshToken = req.cookies?.refreshToken;
    if (rawRefreshToken) {
      const tokenHash = crypto.createHash("sha256").update(rawRefreshToken).digest("hex");
      const pool = getPool();
      await pool.execute(
        "UPDATE `refresh_tokens` SET `revoked` = 1 WHERE `token_hash` = ?",
        [tokenHash]
      );
    }
  } catch (err) {
    console.error("logout token revocation error:", err.message);
  }

  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    path: "/",
  });
  res.clearCookie("refreshToken", {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
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
  refreshSession,
  me,
  logout,
};
