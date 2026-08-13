const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const path = require('path');
const { testConnection } = require('./config/database');
const { sanitizeInput } = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

dotenv.config();

const app = express();
app.set('etag', false);
const isProduction = process.env.NODE_ENV === 'production';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
}));

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// Serve static files from frontend directory (must be before other middleware)
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

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 8889,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'shelterlink',
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 3600000,
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
app.get('/api/my-shifts.ics', myShiftsIcs);
app.get('/api/me/ical-feed', isAuthenticated, getMyIcalToken);
app.get('/api/applications/:id/ics', isAuthenticated, applicationIcs);

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

// Test database connection before starting server
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

    app.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
      console.log(`✓ Frontend files served from: ${path.join(__dirname, 'frontend')}`);
      console.log(`✓ Access your app at: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('✗ Failed to connect to database:', error.message);
    console.error('  Please check your database configuration and ensure MySQL is running.');
    console.error('  Default MAMP settings: host=localhost, port=8889, user=root, password=root');
    process.exit(1);
  }
}

startServer();