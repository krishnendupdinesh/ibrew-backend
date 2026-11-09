// Middleware = a function that runs BEFORE a route, to check something.
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// Reads the login cookie (or Bearer auth header) and finds the user (or returns null).
async function getUserFromCookie(req) {
  let token = req.cookies?.token;
  if (!token && req.headers?.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) return null;

  try {
    const secret = process.env.JWT_SECRET || "adrijbyfkdfkugbcjustsnriudbbdfjf";
    let decoded = null;
    try {
      decoded = jwt.verify(token, secret);
    } catch {
      // Fallback for previous legacy secret
      decoded = jwt.verify(token, "ibrew-super-secret-jwt-key-for-auth");
    }

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
    if (!dbUser) return null;
    return {
      _id: String(dbUser.id),
      id: String(dbUser.id),
      name: dbUser.name,
      email: dbUser.email,
      phone: dbUser.phone || "",
      role: dbUser.role || "customer",
    };
  } catch (error) {
    return null; // token is wrong or expired
  }
}

// Helper kept for backward-compatibility with call sites
function cacheUser(user) {
  return user;
}

// Use on routes where login is REQUIRED
async function requireLogin(req, res, next) {
  const user = await getUserFromCookie(req);
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
