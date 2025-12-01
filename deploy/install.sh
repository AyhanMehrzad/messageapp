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
apt-get install -y python3-pip python3-venv nginx

# 2. Set up Python Environment
echo "Setting up Python virtual environment..."
# Remove existing venv to ensure a clean slate (fixes "pip not found" issues)
rm -rf "$PROJECT_DIR/venv"
python3 -m venv "$PROJECT_DIR/venv"

# Activate venv and install requirements
"$PROJECT_DIR/venv/bin/pip" install --upgrade pip
"$PROJECT_DIR/venv/bin/pip" install -r "$PROJECT_DIR/requirements.txt"

# 3. Configure Systemd Service
echo "Configuring Systemd service..."
SERVICE_TEMPLATE="$SCRIPT_DIR/messageapp.service.template"
SERVICE_FILE="$SCRIPT_DIR/messageapp.service"
TARGET_SERVICE_FILE="/etc/systemd/system/messageapp.service"

# Replace placeholder with actual path
sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" "$SERVICE_TEMPLATE" > "$SERVICE_FILE"

cp "$SERVICE_FILE" "$TARGET_SERVICE_FILE"
systemctl daemon-reload
systemctl enable messageapp
systemctl restart messageapp

# 4. Configure Nginx
echo "Configuring Nginx..."

# Stop Apache if it's running (it conflicts on port 80)
if systemctl is-active --quiet apache2; then
    echo "Stopping Apache2 to free up port 80..."
    systemctl stop apache2
    systemctl disable apache2
fi

NGINX_TEMPLATE="$SCRIPT_DIR/messageapp.nginx.template"
NGINX_FILE="$SCRIPT_DIR/messageapp.nginx"
TARGET_NGINX_FILE="/etc/nginx/sites-available/messageapp"

# Replace placeholder
sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" "$NGINX_TEMPLATE" > "$NGINX_FILE"

cp "$NGINX_FILE" "$TARGET_NGINX_FILE"
ln -sf "$TARGET_NGINX_FILE" /etc/nginx/sites-enabled/

# Remove default nginx site if it exists
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl restart nginx

echo "Deployment complete! Your app should be live at http://$(curl -s ifconfig.me) or your server IP."
