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

# Configure Apache to listen on port 8080 to avoid conflict with Nginx
echo "Configuring Apache2..."
apt-get install -y apache2

# Change Apache port to 8080 (Handle idempotency to prevent 808080)
# This regex searches for Listen followed by 80 and optional extra digits, replacing with fixed 8080
sed -i 's/Listen 80[0-9]*/Listen 8080/' /etc/apache2/ports.conf
# Same for VirtualHost
sed -i 's/<VirtualHost \*:80[0-9]*>/<VirtualHost *:8080>/' /etc/apache2/sites-available/000-default.conf

# Restart Apache to apply changes
echo "Checking Apache configuration..."
if apachectl configtest; then
    systemctl enable apache2
    if ! systemctl restart apache2; then
        echo "WARNING: Apache2 failed to start. Checking logs..."
        journalctl -xeu apache2.service | tail -n 20
        echo "Check if port 8080 is free:"
        netstat -tulpn | grep 8080 || echo "Port 8080 is free or netstat failed"
    fi
else
    echo "ERROR: Apache configuration test failed!"
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

# 5. SSL Configuration (Certbot)
echo "Configuring SSL with Certbot..."
# Only run if domain is reachable (basic check) or force it
certbot --nginx -d securechanel.xyz -d www.securechanel.xyz --non-interactive --agree-tos -m admin@securechanel.xyz --redirect

echo "Deployment complete! Your app should be live at https://securechanel.xyz"

echo "Deployment complete! Your app should be live at http://$(curl -s ifconfig.me) or your server IP."
