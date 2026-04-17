require('dotenv').config();
const fs = require('fs');
const path = require('path');
const app = require('./app');
const connectDB = require('./config/db');

const PORT = process.env.PORT || 5000;
const clientIndexPath = path.resolve(__dirname, '../client/dist/index.html');

const validateRuntimeConfig = () => {
  const missing = ['MONGO_URI', 'JWT_SECRET'].filter((key) => !String(process.env[key] || '').trim());

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (process.env.NODE_ENV === 'production' && !fs.existsSync(clientIndexPath)) {
    throw new Error('Production client build not found. Run `npm run build` before starting the server.');
  }
};

const startServer = async () => {
  try {
    validateRuntimeConfig();
    await connectDB();
    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error(error.message || 'MongoDB connection failed');
    process.exit(1);
  }
};

startServer();
