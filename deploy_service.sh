#!/bin/bash

# Define variables
SERVICE_NAME="messageapp.service"
SYSTEMD_DIR="/etc/systemd/system"

# Detect current directory (Project Root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# Assuming the script is in the root or a subdir, we want the root containing app.py
# If script is in deploy/, parent is root. If in root, it is root.
if [ -f "$SCRIPT_DIR/app.py" ]; then
    PROJECT_DIR="$SCRIPT_DIR"
elif [ -f "$SCRIPT_DIR/../app.py" ]; then
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
else
    echo "Error: Could not locate app.py. Please run this script from the project root or deploy directory."
    exit 1
fi

echo "Project Directory: $PROJECT_DIR"

# Detect User (Owner of app.py)
APP_USER=$(stat -c '%U' "$PROJECT_DIR/app.py")
APP_GROUP=$(stat -c '%G' "$PROJECT_DIR/app.py")
echo "Detected App User: $APP_USER"
echo "Detected App Group: $APP_GROUP"

# Verify venv exists
VENV_BIN="$PROJECT_DIR/venv/bin"
if [ ! -d "$VENV_BIN" ]; then
    echo "Error: Virtual environment not found at $VENV_BIN"
    echo "Please create it or ensure it exists."
    exit 1
fi

GUNICORN_PATH="$VENV_BIN/gunicorn"

echo "Generating service file..."

# Create the service file content dynamically
SERVICE_CONTENT="[Unit]
Description=Gunicorn instance to serve Message App
After=network.target

[Service]
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$PROJECT_DIR
Environment=\"PATH=$VENV_BIN\"
ExecStart=$GUNICORN_PATH --config gunicorn_config.py app:app
Restart=always

[Install]
WantedBy=multi-user.target"

# Write to systemd directory
echo "Installing service to $SYSTEMD_DIR/$SERVICE_NAME..."
echo "$SERVICE_CONTENT" | sudo tee "$SYSTEMD_DIR/$SERVICE_NAME" > /dev/null

# Clean up any existing process on port 5000 (e.g., manual runs)
echo "Checking for conflicting processes on port 5000..."
if sudo lsof -i :5000 > /dev/null 2>&1; then
    echo "Killing existing process on port 5000..."
    sudo fuser -k 5000/tcp > /dev/null 2>&1
    sleep 2
fi

# Reload systemd daemon
echo "Reloading systemd daemon..."
sudo systemctl daemon-reload

# Enable the service
echo "Enabling $SERVICE_NAME..."
sudo systemctl enable "$SERVICE_NAME"

# Restart the service
echo "Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

# Check status
echo "Checking service status..."
sudo systemctl status "$SERVICE_NAME" --no-pager

echo "Deployment complete!"
