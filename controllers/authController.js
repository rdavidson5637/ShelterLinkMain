const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const User = require('../models/User');
const { sendEmail } = require('../utils/emailService');
const { clearSessionCookie } = require('../utils/sessionCookie');
const {
  hashResetToken,
  createResetToken,
  productionResetBaseUrl,
} = require('../utils/resetToken');

const GENERIC_RESET_MESSAGE = 'If that email is registered, a reset link has been sent.';

function respondSafeUser(row) {
  if (!row) return null;
  const { password, reset_token, reset_token_expires, ...safe } = row;
  return safe;
}

function isStrongPassword(password = '') {
  const pwd = String(password);
  const hasMinLength = pwd.length >= 8;
  const hasUppercase = /[A-Z]/.test(pwd);
  const hasNumber = /[0-9]/.test(pwd);
  return hasMinLength && hasUppercase && hasNumber;
}

async function register(req, res) {
  try {
    const { first_name, last_name, email, password, phone } = req.body || {};
    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'first_name, last_name, email, and password are required' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with one uppercase letter and one number',
      });
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const name = [first_name, last_name].filter(Boolean).join(' ').trim();
    const passwordHash = await bcrypt.hash(String(password), 10);

    const sql = `
      INSERT INTO users (first_name, last_name, name, phone, email, password, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'volunteer', NOW())
    `;
    await pool.execute(sql, [first_name, last_name, name, phone || null, email, passwordHash]);

    return res.status(201).json({ message: 'Registration successful' });
  } catch (error) {
    console.error('[Auth] register error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const [rows] = await pool.execute(
      `SELECT user_id, first_name, last_name, name, email, password, role, created_at
       FROM users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(String(password), String(user.password));
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    req.session.userId = user.user_id;
    req.session.role = user.role;

    // Update last login
    await pool.execute('UPDATE users SET last_login = NOW() WHERE user_id = ?', [user.user_id]);

    return res.status(200).json(respondSafeUser(user));
  } catch (error) {
    console.error('[Auth] login error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function logout(req, res) {
  try {
    if (!req.session) {
      return res.status(200).json({ message: 'Logged out' });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to logout' });
      }
      clearSessionCookie(res);
      return res.status(200).json({ message: 'Logged out' });
    });
  } catch (error) {
    console.error('[Auth] logout error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function registerAdmin(req, res) {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_ADMIN_REGISTRATION !== 'true') {
      return res.status(404).json({ error: 'API endpoint not found' });
    }

    const { first_name, last_name, email, password, admin_key, phone } = req.body || {};

    const ADMIN_REGISTRATION_KEY = process.env.ADMIN_REGISTRATION_KEY;
    if (!ADMIN_REGISTRATION_KEY) {
      return res.status(500).json({ error: 'Admin registration is not configured' });
    }

    if (admin_key !== ADMIN_REGISTRATION_KEY) {
      return res.status(403).json({ error: 'Invalid admin registration key' });
    }

    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'first_name, last_name, email, and password are required' });
    }

    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    const name = [first_name, last_name].filter(Boolean).join(' ').trim();
    const passwordHash = await bcrypt.hash(String(password), 10);

    const sql = `
      INSERT INTO users (first_name, last_name, name, phone, email, password, role, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'admin', NOW())
    `;
    await pool.execute(sql, [first_name, last_name, name, phone || null, email, passwordHash]);

    return res.status(201).json({ message: 'Admin registration successful' });
  } catch (error) {
    console.error('[Auth] registerAdmin error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getCurrentUser(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const [rows] = await pool.execute(
      `SELECT user_id, first_name, last_name, name, email, role, created_at
       FROM users
       WHERE user_id = ?
       LIMIT 1`,
      [req.session.userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.status(200).json(respondSafeUser(user));
  } catch (error) {
    console.error('[Auth] getCurrentUser error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Password Reset ────────────────────────────────────────────────────────────

async function forgotPassword(req, res) {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }

    const generic = () => res.status(200).json({ message: GENERIC_RESET_MESSAGE });

    const appUrl = productionResetBaseUrl();
    if (!appUrl) {
      console.error('[Auth] forgotPassword refused: APP_URL missing or localhost in production');
      return generic();
    }

    const [rows] = await pool.execute(
      'SELECT user_id, email, first_name FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    const user = rows[0];
    if (!user) return generic();

    const { raw, hash } = createResetToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000);

    await pool.execute(
      'UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE user_id = ?',
      [hash, expires, user.user_id]
    );

    const resetLink = `${appUrl}/reset-password.html?token=${raw}`;

    try {
      await sendEmail(
        user.email,
        'Reset Your ShelterLink Password',
        `
          <p>Hi ${user.first_name || 'there'},</p>
          <p>We received a request to reset your ShelterLink password.</p>
          <p>
            <a href="${resetLink}" style="display:inline-block;padding:0.6rem 1.4rem;background:#2e7d32;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">
              Reset My Password
            </a>
          </p>
          <p>Or copy this link into your browser:<br/><small>${resetLink}</small></p>
          <p>This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email.</p>
          <p>Thanks,<br/>The ShelterLink Team</p>
        `
      );
    } catch (emailError) {
      console.error('[Auth] forgotPassword email error:', emailError.message);
      await pool.execute(
        'UPDATE users SET reset_token = NULL, reset_token_expires = NULL WHERE user_id = ? AND reset_token = ?',
        [user.user_id, hash]
      );
      return generic();
    }

    return generic();
  } catch (error) {
    console.error('[Auth] forgotPassword error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function validateResetToken(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      return res.status(200).json({ valid: false });
    }

    const [rows] = await pool.execute(
      `SELECT reset_token_expires
       FROM users
       WHERE reset_token = ?
       LIMIT 1`,
      [hashResetToken(token)]
    );
    const user = rows[0];
    if (!user || new Date(user.reset_token_expires) < new Date()) {
      return res.status(200).json({ valid: false });
    }
    return res.status(200).json({ valid: true });
  } catch (error) {
    console.error('[Auth] validateResetToken error:', error.message);
    return res.status(200).json({ valid: false });
  }
}

async function resetPassword(req, res) {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return res.status(400).json({ error: 'token and password are required' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters with one uppercase letter and one number',
      });
    }

    const [rows] = await pool.execute(
      `SELECT user_id, reset_token_expires
       FROM users
       WHERE reset_token = ?
       LIMIT 1`,
      [hashResetToken(token)]
    );
    const user = rows[0];

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    if (new Date(user.reset_token_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    await pool.execute(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE user_id = ?',
      [passwordHash, user.user_id]
    );

    return res.status(200).json({ message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    console.error('[Auth] resetPassword error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  register,
  registerAdmin,
  login,
  logout,
  getCurrentUser,
  forgotPassword,
  validateResetToken,
  resetPassword,
};
