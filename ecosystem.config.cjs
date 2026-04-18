/**
 * PM2 Ecosystem Configuration
 *
 * For deployments without Docker/Kubernetes, PM2 provides:
 * - Cluster mode: N workers sharing port 3000 (one per CPU core)
 * - Auto-restart on crash
 * - Zero-downtime reload
 * - Memory limit restart
 * - Log management
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs   # zero-downtime
 *   pm2 scale loar-server +2           # add 2 more instances
 *   pm2 monit                          # real-time dashboard
 */

module.exports = {
  apps: [
    {
      name: 'loar-server',
      script: 'apps/server/dist/index.js',
      instances: 'max', // One per CPU core
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TRUST_PROXY: 'true',
      },
      // Auto-restart if memory exceeds 1.5GB
      max_memory_restart: '1500M',
      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 10000,
      // Exponential restart delay (prevents restart storms)
      exp_backoff_restart_delay: 100,
      // Log configuration
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Watch for changes (disable in production)
      watch: false,
    },
    {
      name: 'loar-worker',
      script: 'apps/server/dist/workers/generation.worker.js',
      instances: 2,
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        WORKER_CONCURRENCY: 5,
      },
      max_memory_restart: '2000M',
      kill_timeout: 30000, // Workers need more time to finish active jobs
      exp_backoff_restart_delay: 100,
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      watch: false,
    },
  ],
};
