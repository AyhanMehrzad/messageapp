#!/bin/bash

# Update Script for SecureChanel App
# Usage: ./update_app.sh

set -e

# Configuration
APP_DIR="/var/www/html" # Change this if your app is elsewhere
VENV_DIR="$APP_DIR/venv"
FRONTEND_DIR="$APP_DIR/frontend"

echo "=========================================="
echo "   Updating SecureChanel Application"
echo "=========================================="

# 1. Pull Latest Code
echo "[1/4] Pulling latest changes from Git..."
cd "$APP_DIR"
git pull origin main

# 2. Update Backend Dependencies
echo "[2/4] Updating Backend Dependencies..."
if [ -f "requirements.txt" ]; then
    "$VENV_DIR/bin/pip" install -r requirements.txt
fi

# 3. Build Frontend
echo "[3/4] Building Frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build
cd "$APP_DIR"

# 4. Restart Services
echo "[4/4] Restarting Gunicorn Backend..."

# Aggressively kill existing Gunicorn/Python processes related to the app
echo "Stopping old processes..."
fuser -k 3002/tcp || true
pkill -f "gunicorn" || true
pkill -f "app:app" || true
sleep 2 # Wait for ports to clear

# Start Gunicorn in Daemon mode
"$VENV_DIR/bin/gunicorn" -D -k eventlet -w 1 -b 0.0.0.0:3002 app:app

echo "=========================================="
echo "   Update Complete! System is Live."
echo "=========================================="
