const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const { testConnection, pgPool, closePool, pool } = require('./config/database');
const { sanitizeInput } = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config();

const app = express();
app.set('etag', false);
app.set('trust proxy', 1);
const isProduction = process.env.NODE_ENV === 'production';

// Fail fast rather than booting production on placeholder secrets.
if (isProduction) {
  const missing = [];
  const isPlaceholder = (v) => !v || /^change_me/i.test(v);
  if (isPlaceholder(process.env.SESSION_SECRET)) missing.push('SESSION_SECRET');
  if (isPlaceholder(process.env.ADMIN_REGISTRATION_KEY)) missing.push('ADMIN_REGISTRATION_KEY');
  if (!process.env.APP_URL) missing.push('APP_URL');
  if (missing.length) {
    console.error('\u2717 Refusing to start in production without: ' + missing.join(', '));
    console.error('  Set these on the host and redeploy. See DEPLOY.md.');
    process.exit(1);
  }
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
    },
  },
}));

// Credentialed cross-origin requests are limited to APP_URL in production.
// Same-origin requests are unaffected: browsers do not apply CORS to them,
// and the frontend is served by this same app. Development stays permissive
// so localhost ports and phones on the LAN can hit the API.
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.APP_URL || '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!isProduction) return callback(null, true);
    if (!origin) return callback(null, true);
    return callback(null, allowedOrigins.includes(origin.replace(/\/$/, '')));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Serve static files from frontend directory (must be before other middleware)
// Never serve the stale localhost API config, even if the file is restored.
app.get('/public/js/config.js', (req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

app.use(express.static(path.join(__dirname, 'frontend')));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent API response caching
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Sessions
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_in_env';

const sessionStore = new PgSession({
  pool: pgPool,
  createTableIfMissing: true,
  pruneSessionInterval: 900,
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,
    maxAge: 3600000, // 1 hour
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  },
}));

// Sanitize incoming request input before route controllers.
app.use(sanitizeInput);
app.use('/api', apiLimiter);

const {
  isAuthenticated,
  restrictKioskSession,
} = require('./middleware/auth');

app.use('/api', restrictKioskSession);

// Routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const opportunityRoutes = require('./routes/opportunities');
const applicationRoutes = require('./routes/applications');
const hoursRoutes = require('./routes/hours');
const adminRoutes = require('./routes/admin');
const exportRoutes = require('./routes/export');
const publicRoutes = require('./routes/public');
const statsRoutes = require('./routes/stats');
const qualificationRoutes = require('./routes/qualifications');
const customFieldRoutes = require('./routes/customFields');
const waiverRoutes = require('./routes/waivers');
const documentRoutes = require('./routes/documents');
const tagRoutes = require('./routes/tags');
const feedbackRoutes = require('./routes/feedback');
const groupBookingRoutes = require('./routes/groupBookings');
const kioskRoutes = require('./routes/kiosk');
const animalRoutes = require('./routes/animals');
const fosterRoutes = require('./routes/fosters');
const transportRoutes = require('./routes/transport');
const incidentRoutes = require('./routes/incidents');
const threadRoutes = require('./routes/threads');
const vettingRoutes = require('./routes/vetting');
const pushRoutes = require('./routes/push');
const templateRoutes = require('./routes/templates');
const {
  myShiftsIcs,
  getMyIcalToken,
  applicationIcs,
} = require('./controllers/publicController');

app.use('/api/auth', authRoutes);
app.use('/api/volunteer', profileRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/hours', hoursRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/qualifications', qualificationRoutes);
app.use('/api/custom-fields', customFieldRoutes);
app.use('/api/waivers', waiverRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/group-bookings', groupBookingRoutes);
app.use('/api/kiosk', kioskRoutes);
app.use('/api/animals', animalRoutes);
app.use('/api/fosters', fosterRoutes);
app.use('/api/transport', transportRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/threads', threadRoutes);
app.use('/api/vetting', vettingRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/opportunity-templates', templateRoutes);
app.get('/api/my-shifts.ics', myShiftsIcs);
app.get('/api/me/ical-feed', isAuthenticated, getMyIcalToken);
app.get('/api/applications/:id/ics', isAuthenticated, applicationIcs);

app.get('/healthz', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 AS ok');
    if (!rows || !rows.length) throw new Error('empty');
    return res.status(200).json({ db: true });
  } catch {
    return res.status(503).json({ db: false });
  }
});

// Serve index.html for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'kiosk.html'));
});

// Health/test route for API
app.get('/api', (req, res) => {
  res.send('ShelterLink API Running');
});

// 404 handler for API routes only
app.use('/api/*', (req, res, next) => {
  next({
    type: 'not_found',
    message: 'API endpoint not found',
  });
});

// 404 handler for non-API routes (frontend pages)
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next();
  }
  return res
    .status(404)
    .sendFile(path.join(__dirname, 'frontend', 'pages', 'error', '404.html'));
});

// Last middleware: centralized API error handler.
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;
let httpServer = null;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] ${signal} received, closing...`);
  const scheduler = require('./utils/scheduler');
  scheduler.stop();
  const force = setTimeout(() => {
    console.error('[Shutdown] Timed out, exiting');
    process.exit(1);
  }, 10000);
  if (typeof force.unref === 'function') force.unref();

  const finish = async () => {
    try {
      await closePool();
    } catch (err) {
      console.error('[Shutdown] pool close error:', err.message);
    }
    process.exit(0);
  };

  if (!httpServer) {
    finish();
    return;
  }
  httpServer.close(() => {
    finish();
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function startServer() {
  try {
    console.log('Testing database connection...');
    await testConnection();
    console.log('✓ Database connection successful!');

    if (process.env.NODE_ENV !== 'test') {
      const scheduler = require('./utils/scheduler');
      const { registerAllJobs } = require('./jobs');
      registerAllJobs();
      scheduler.start();
    }

    httpServer = app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Frontend files served from: ${path.join(__dirname, 'frontend')}`);
      console.log(`✓ Access your app at: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    console.error('  Check DATABASE_URL (Supabase session pooler, port 5432) or local DB_* values.');
    process.exit(1);
  }
}

startServer();
