module.exports = {
  apps: [{
    name: 'aurum-ofx-reader',
    script: 'index.js',
    // Load environment variables from .env file
    env_file: '.env',
    // Ensure PM2 runs from the correct directory
    cwd: '/mnt/volume_nyc3_01/apps/aurum-auto-ofx-reader',
    // Restart policy
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Environment-specific settings
    env: {
      NODE_ENV: 'production'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};