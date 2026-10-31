// Middleware = a function that runs BEFORE a route, to check something.
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// In-memory cache so we don't query MySQL on every single API call
const userCacheById = new Map();

function cacheUser(user) {
  if (!user) return null;
  const plain = typeof user.toJSON === "function" ? user.toJSON() : {
    id: String(user._id || user.id),
    _id: String(user._id || user.id),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    role: user.role || "customer",
  };
  plain._id = plain.id;
  userCacheById.set(String(plain.id), plain);
  return plain;
}

// Reads the login cookie and finds the user (or returns null).
async function getUserFromCookie(req) {
  const token = req.cookies.token;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fast path 1: token already embeds user profile fields -> 0ms (no DB query needed!)
    if (decoded && decoded.id && decoded.email && decoded.role) {
      return {
        _id: decoded.id,
        id: String(decoded.id),
        name: decoded.name || "User",
        email: decoded.email,
        phone: decoded.phone || "",
        role: decoded.role,
      };
    }

    // Fast path 2: check in-memory cache by user ID
    if (decoded && decoded.id && userCacheById.has(String(decoded.id))) {
      return userCacheById.get(String(decoded.id));
    }

    // Fallback: query MySQL once and cache
    const dbUser = await User.findById(decoded.id);
    return cacheUser(dbUser);
  } catch (error) {
    return null; // token is wrong or expired
  }
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
