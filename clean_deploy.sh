#!/bin/bash

# clean_deploy.sh - Completely wipes and redeploys the application
# This script is intended for the production server to ensure a fresh state.

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/venv"
FRONTEND_DIR="$PROJECT_DIR/frontend"
STATIC_DIR="$PROJECT_DIR/static"
TEMPLATE_DIR="$PROJECT_DIR/templates"

echo "=== Starting Clean Installation ==="

# 1. Stop the service if it exists
echo "Stopping messageapp service..."
sudo systemctl stop messageapp.service || true

# 2. Kill any processes on port 5000 just in case
echo "Cleaning up port 5000..."
sudo fuser -k 5000/tcp || true

# 3. Wipe build artifacts and environments
echo "Wiping existing artifacts..."
rm -rf "$VENV_DIR"
rm -rf "$FRONTEND_DIR/node_modules"
rm -rf "$FRONTEND_DIR/build"
rm -rf "$STATIC_DIR"/*
mkdir -p "$STATIC_DIR"
touch "$STATIC_DIR/.gitkeep"
rm -f "$TEMPLATE_DIR/index.html"

# 4. Pull latest code
echo "Pulling latest code from GitHub..."
git fetch origin main
git reset --hard origin/main

# 5. Run the deployment script
echo "Running full deployment..."
chmod +x deploy.sh
./deploy.sh

# 6. Re-install and Restart the service
echo "Re-installing and restarting the service..."
chmod +x deploy_service.sh
sudo ./deploy_service.sh

echo "=== Clean Installation Complete ==="
echo "Please verify by logging in and testing the Ping feature."
