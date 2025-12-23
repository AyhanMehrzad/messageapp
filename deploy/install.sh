#!/bin/bash

# Exit on error
set -e

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "Please run as root (sudo ./deploy/install.sh)"
  exit 1
fi

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# Project root is one level up
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Deploying from $PROJECT_DIR..."

# 1. Install Dependencies
echo "Installing system dependencies..."
apt-get update
apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

# 1.5 Update Frontend (Build React App)
echo "Building and deploying Frontend..."
chmod +x "$SCRIPT_DIR/update_frontend.sh"
"$SCRIPT_DIR/update_frontend.sh"

# 2. Set up Python Environment
echo "Setting up Python virtual environment..."
# Remove existing venv to ensure a clean slate (fixes "pip not found" issues)
rm -rf "$PROJECT_DIR/venv"
python3 -m venv "$PROJECT_DIR/venv"

# Activate venv and install requirements
"$PROJECT_DIR/venv/bin/pip" install --upgrade pip
"$PROJECT_DIR/venv/bin/pip" install -r "$PROJECT_DIR/requirements.txt"


echo "Dependency installation and build complete!"
echo "To run the application manually from $PROJECT_DIR:"
echo "  source venv/bin/activate"
echo "  python3 app.py"

