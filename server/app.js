require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const masterRoutes = require('./routes/masterRoutes');
const stockRoutes = require('./routes/stockRoutes');
const reportRoutes = require('./routes/reportRoutes');
const authRoutes = require('./routes/authRoutes');
const roleRoutes = require('./routes/roleRoutes');

const { protect } = require('./middleware/authMiddleware');

const app = express();
const clientDistPath = path.resolve(__dirname, '../client/dist');

const normalizeOrigin = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withProtocol).origin;
  } catch (error) {
    return text.replace(/\/+$/, '');
  }
};

const parseOriginList = (...values) =>
  values
    .filter(Boolean)
    .flatMap((value) => String(value).split(',').map((origin) => origin.trim()).filter(Boolean))
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5176',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5176',
];
const envOrigins = parseOriginList(process.env.CLIENT_URL, process.env.FRONTEND_URL, process.env.CORS_ORIGINS);
const vercelOrigins = parseOriginList(
  process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).trim()}` : '',
  process.env.VERCEL_BRANCH_URL ? `https://${String(process.env.VERCEL_BRANCH_URL).trim()}` : ''
);
const allowedOrigins = new Set([...defaultOrigins, ...envOrigins, ...vercelOrigins].map((origin) => normalizeOrigin(origin)).filter(Boolean));
const allowAllOrigins =
  process.env.CORS_ALLOW_ALL === 'true' ||
  (process.env.NODE_ENV === 'production' && envOrigins.length === 0);
const vercelOriginPattern = /^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/;
const localhostPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      const normalizedOrigin = normalizeOrigin(origin);
      if (
        !origin ||
        allowAllOrigins ||
        (normalizedOrigin && (allowedOrigins.has(normalizedOrigin) || localhostPattern.test(normalizedOrigin) || vercelOriginPattern.test(normalizedOrigin)))
      ) {
        callback(null, true);
        return;
      }
      callback(new Error('CORS origin not allowed'));
    },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/master', protect, masterRoutes);
app.use('/api/stocks', protect, stockRoutes);
app.use('/api/reports', protect, reportRoutes);
app.use('/api/roles', protect, roleRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDistPath, { index: false, maxAge: '1h' }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }

    res.sendFile(path.join(clientDistPath, 'index.html'), (error) => {
      if (error) {
        next(error);
      }
    });
  });
}

app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));
app.use(errorHandler);

module.exports = app;
