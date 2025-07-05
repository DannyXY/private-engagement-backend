const app = require('./app');
const { processEngagements } = require('./worker');
const cron = require('node-cron');

const PORT = process.env.PORT || 4000;

console.log('🚀 Starting private engager backend server...');
console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔧 Port: ${PORT}`);

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Server URL: http://localhost:${PORT}`);
  
  // Start the engagement worker cron job with the server
  console.log('⏰ Initializing engagement worker cron job...');
  cron.schedule('* * * * *', async () => {
    console.log('\n⏰ Cron job triggered from main server...');
    try {
      await processEngagements();
      console.log('✅ Main server cron job completed successfully');
    } catch (error) {
      console.log('❌ Main server cron job failed with error:', error);
    }
  });
  console.log('✅ Engagement worker cron job started with server (every minute).');
  console.log('🎉 Private engager backend fully initialized and ready!');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.log('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.log('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
}); 