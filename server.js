// Error reporting first so it can see everything; a no-op without SENTRY_DSN.
require('dotenv').config();
require('./utils/sentry').initSentry();

const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const { testConnection, pgPool, closePool, pool } = require('./config/database');
const { sanitizeInput } = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { validateEnv, logStartupWarnings } = require('./utils/validateEnv');
const { wwwToApex } = require('./utils/seo');
const { corsOriginDelegate } = require('./utils/corsOrigins');
const { sessionCookieOptions } = require('./utils/sessionCookie');
const { cspDirectives } = require('./utils/csp');
const { buildServiceWorker, getSwVersion } = require('./utils/serviceWorker');

dotenv.config();
validateEnv();
logStartupWarnings();

const app = express();
app.set('etag', false);
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives(process.env.NODE_ENV === 'production'),
  },
}));

app.use(compression());

// Credentialed CORS: production allowlists https://shelterlink.online (plus
// APP_URL / CORS_ORIGINS). Non-production allows localhost only. Same-origin
// browser requests do not use CORS.
app.use(cors({
  origin: corsOriginDelegate,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Never serve the stale localhost API config/auth files, even if restored —
// these were deleted (superseded by frontend/js/config.js and auth.js) but a
// backup or stale deploy artifact could still drop them back on disk.
app.get('/public/js/config.js', (req, res) => {
  res.status(404).type('text/plain').send('Not found');
});
app.get('/public/js/auth.js', (req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

const swSource = fs.readFileSync(path.join(__dirname, 'frontend', 'sw.js'), 'utf8');
const swBody = buildServiceWorker(swSource, getSwVersion());
app.get('/sw.js', (req, res) => {
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Service-Worker-Allowed': '/',
  });
  res.send(swBody);
});

// SEO: www -> apex 301, robots.txt, sitemap.xml and the public pages with
// absolute canonical/OG URLs (must come before express.static).
app.use(wwwToApex());
app.use(require('./routes/seo'));

app.use(express.static(path.join(__dirname, 'frontend'), {
  setHeaders(res, filePath) {
    const rel = filePath.replace(/\\/g, '/');
    if (rel.includes('/public/css/vendor/') || rel.includes('/public/js/vendor/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    if (rel.includes('/public/icons/') || rel.includes('/public/images/')) {
      res.setHeader('Cache-Control', 'public, max-age=604800');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent API response caching
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Sessions — no fallback secret. Production already exited if this is weak.
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error('\u2717 SESSION_SECRET is required. Set it in .env (see .env.example).');
  process.exit(1);
}

const sessionStore = new PgSession({
  pool: pgPool,
  createTableIfMissing: true,
  pruneSessionInterval: 900,
});

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  store: sessionStore,
  cookie: {
    ...sessionCookieOptions(),
    maxAge: 3600000, // 1 hour of inactivity
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

app.get('/launch', require('./controllers/launchController').launch);

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
