// Middleware = a function that runs BEFORE a route, to check something.
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getPool } = require("../config/mysql");

// Reads the login cookie (or Bearer auth header) and finds the user (or returns null).
// If access token is expired, attempts seamless background refresh via refreshToken cookie.
async function getUserFromCookie(req, res = null) {
  let token = req.cookies?.token;
  if (!token && req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }

  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) return null;

  if (token) {
    try {
      const decoded = jwt.verify(token, secret);

      // Fast path: verified token already embeds user profile fields
      if (decoded && decoded.id && decoded.email && decoded.role) {
        return {
          _id: String(decoded.id),
          id: String(decoded.id),
          name: decoded.name || "User",
          email: decoded.email,
          phone: decoded.phone || "",
          role: decoded.role,
        };
      }

      // Direct MySQL fallback if fields were not in token
      const dbUser = await User.findById(decoded.id);
      if (dbUser) {
        return {
          _id: String(dbUser.id),
          id: String(dbUser.id),
          name: dbUser.name,
          email: dbUser.email,
          phone: dbUser.phone || "",
          role: dbUser.role || "customer",
        };
      }
    } catch {
      // Access token expired or invalid; continue to refreshToken fallback below
    }
  }

  // Seamless background refresh using persistent refreshToken cookie if available
  const rawRefreshToken = req.cookies?.refreshToken;
  if (rawRefreshToken && res && typeof res.cookie === "function") {
    try {
      const tokenHash = crypto.createHash("sha256").update(rawRefreshToken).digest("hex");
      const pool = getPool();

      const [rows] = await pool.execute(
        `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, u.id as uid, u.name, u.email, u.phone, u.role
         FROM \`refresh_tokens\` rt
         JOIN \`users\` u ON rt.user_id = u.id
         WHERE rt.token_hash = ? AND rt.revoked = 0 AND rt.expires_at > NOW() LIMIT 1`,
        [tokenHash]
      );

      if (rows && rows.length > 0) {
        const record = rows[0];
        const refreshedUser = {
          _id: String(record.uid),
          id: String(record.uid),
          name: record.name,
          email: record.email,
          phone: record.phone || "",
          role: record.role || "customer",
        };

        const isCustomer = refreshedUser.role === "customer";
        const accessExpiry = isCustomer ? "30d" : "2h";
        const accessMaxAge = isCustomer
          ? 30 * 24 * 60 * 60 * 1000 // 30 days
          : 2 * 60 * 60 * 1000; // 2 hours

        // Mint fresh access token
        const newAccessToken = jwt.sign(
          {
            id: refreshedUser.id,
            name: refreshedUser.name,
            email: refreshedUser.email,
            phone: refreshedUser.phone || "",
            role: refreshedUser.role,
          },
          secret,
          { expiresIn: accessExpiry }
        );

        const isProd = process.env.NODE_ENV === "production";
        res.cookie("token", newAccessToken, {
          httpOnly: true,
          sameSite: "lax",
          secure: isProd,
          path: "/",
          maxAge: accessMaxAge,
        });

        return refreshedUser;
      }
    } catch (e) {
      // Refresh failed; proceed to return null
    }
  }

  return null;
}

// Helper kept for backward-compatibility with call sites
function cacheUser(user) {
  return user;
}

// Use on routes where login is REQUIRED
async function requireLogin(req, res, next) {
  const user = await getUserFromCookie(req, res);
  if (!user) return res.status(401).json({ error: "Please log in first." });
  req.user = user;
  next();
}

// Use on routes only the admin may open (put it AFTER requireLogin)
function requireAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Admins only." });
  }
  next();
}

module.exports = { getUserFromCookie, requireLogin, requireAdmin, cacheUser };
