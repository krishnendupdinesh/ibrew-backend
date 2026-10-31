const express = require("express");
const { requireLogin, requireAdmin } = require("../middleware/auth");
const {
  register,
  login,
  setupAdmin,
  getResetPasswordInfo,
  resetPassword,
  me,
  logout,
} = require("../controllers/authController");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/setup-admin", setupAdmin);
router.get("/reset-password", requireLogin, requireAdmin, getResetPasswordInfo);
router.post("/reset-password", requireLogin, requireAdmin, resetPassword);
router.get("/me", me);
router.post("/logout", logout);

module.exports = router;
