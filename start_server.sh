#!/bin/bash
# Start the FastAPI server
echo "Starting Secure Messaging App (FastAPI)..."
echo "=========================================="

cd "$(dirname "$0")"
source venv/bin/activate

# Stop any existing python server on port 3002
fuser -k 3002/tcp > /dev/null 2>&1

# Run uvicorn
# app_asgi is the combined SocketIO + FastAPI app
exec uvicorn main:app_asgi --host 0.0.0.0 --port 3002 --reload
