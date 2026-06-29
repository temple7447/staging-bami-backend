module.exports = {
  apps: [
    {
      name: "bami-backend",
      cwd: "/Users/temple/Documents/Bami/BamiHustle-backend/fastapi_app",
      script: "/Users/temple/Documents/Bami/BamiHustle-backend/fastapi_app/venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 4000 --reload",
      interpreter: "none",
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 20,
      env: {
        PYTHONPATH: "/Users/temple/Documents/Bami/BamiHustle-backend/fastapi_app",
      },
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "/Users/temple/Documents/Bami/BamiHustle-backend/logs/error.log",
      out_file: "/Users/temple/Documents/Bami/BamiHustle-backend/logs/out.log",
      merge_logs: true,
    },
  ],
};
