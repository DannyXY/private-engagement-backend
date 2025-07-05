const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

console.log('🔧 Loading environment variables...');
dotenv.config();
console.log('✅ Environment variables loaded');

console.log('🏗️ Initializing Express application...');
const app = express();

console.log('📦 Setting up middleware...');
app.use(express.json());
console.log('✅ JSON middleware configured');

app.use(cors());
console.log('✅ CORS middleware configured');

app.use(helmet());
console.log('✅ Helmet security middleware configured');

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

console.log('🏥 Setting up health check endpoint...');
app.get('/health', (req, res) => {
  console.log('💚 Health check requested');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

console.log('🛣️ Loading route modules...');
const authRoutes = require('./routes/auth');
const engagementRoutes = require('./routes/engagement');
console.log('✅ Route modules loaded');

console.log('🔗 Registering routes...');
app.use('/auth', authRoutes);
console.log('✅ Auth routes registered at /auth');

app.use('/engagement', engagementRoutes);
console.log('✅ Engagement routes registered at /engagement');

console.log('✅ Express application setup complete');

module.exports = app; 