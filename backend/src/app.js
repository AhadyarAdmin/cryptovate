const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

//Rate Limiting
const { generalRateLimit, authRateLimit, otpRateLimit } = require('./middleware/rateLimiter.middleware');

const app = express();

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://cryptovate.ahadyar.tech'] 
    : ['http://localhost:3000', 'http://localhost:19006'],
  credentials: true
}));

//Rate Limiting
app.use(generalRateLimit);

// Logging
app.use(morgan('combined'));

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static Files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

//Routes mit spezifischen Rate Limits
app.use('/api/auth/register/initiate', otpRateLimit);
app.use('/api/auth/password-reset/initiate', otpRateLimit);
app.use('/api/auth', authRateLimit);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/mlm', require('./routes/mlm.routes'));
app.use('/api/kyc', require('./routes/kyc.routes'));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : err.message 
  });
});

// 404 Handler
app.all('/*all', (req, res) => {
  res.status(404).json({ 
    success: false, 
    error: 'Route not found' 
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 URL: ${process.env.APP_URL}`);
});

module.exports = app;
