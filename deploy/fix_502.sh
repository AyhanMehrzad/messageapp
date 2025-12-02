#!/bin/bash

echo "Fixing 502 Bad Gateway (Port 80 Conflict)..."

# 1. Stop web servers
echo "Stopping web services..."
systemctl stop apache2 2>/dev/null || true
systemctl stop nginx 2>/dev/null || true

# 2. Kill any remaining processes on port 80
echo "Killing processes on port 80..."
fuser -k 80/tcp 2>/dev/null || true
killall -9 apache2 2>/dev/null || true
killall -9 nginx 2>/dev/null || true

# 3. Restart Nginx
echo "Starting Nginx..."
systemctl start nginx

# 4. Check status
if systemctl is-active --quiet nginx; then
    echo "✅ Nginx started successfully!"
else
    echo "❌ Nginx failed to start. Checking status:"
    systemctl status nginx --no-pager
fi
