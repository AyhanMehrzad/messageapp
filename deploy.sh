#!/bin/bash

# deploy.sh - Unified Deployment Script for Secure Channel App

set -e # Exit on error

# --- Configuration ---
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$PROJECT_DIR/frontend"
VENV_DIR="$PROJECT_DIR/venv"
PYTHON_CMD="python3"
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# --- Helper Functions ---
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 could not be found. Please install it."
        exit 1
    fi
}

# --- 1. Prerequisites Check ---
log_info "Checking prerequisites..."
check_command "$PYTHON_CMD"
check_command "node"
check_command "npm"

# --- 2. Backend Setup ---
log_info "Setting up Backend..."

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    log_info "Creating Python virtual environment..."
    $PYTHON_CMD -m venv "$VENV_DIR"
fi

# Activate venv
source "$VENV_DIR/bin/activate"

# Install Python dependencies
if [ -f "$PROJECT_DIR/requirements.txt" ]; then
    log_info "Installing Python dependencies (with system override for Ubuntu 24.04)..."
    # Use --break-system-packages to allow root installation on newer Ubuntu versions
    # and --ignore-installed to ensure we get the versions we want in the venv
    "$VENV_DIR/bin/pip" install --break-system-packages --ignore-installed -r "$PROJECT_DIR/requirements.txt"
else
    log_error "requirements.txt not found!"
    exit 1
fi

# --- 3. Frontend Setup ---
log_info "Setting up Frontend..."

if [ -d "$FRONTEND_DIR" ]; then
    cd "$FRONTEND_DIR"
    if [ ! -d "node_modules" ]; then
        log_info "Installing Node modules (this might take a while)..."
        npm install
    else 
        log_info "Node modules already installed."
    fi
    cd "$PROJECT_DIR"
else
    log_error "Frontend directory not found at $FRONTEND_DIR"
    exit 1
fi

# --- 4. Execution Mode ---

MODE="prod" # Default mode

if [[ "$1" == "--dev" ]]; then
    MODE="dev"
fi

if [ "$MODE" == "dev" ]; then
    log_info "Starting in DEVELOPMENT mode..."
    log_info "Starting Flask Backend (Background)..."
    python app.py &
    FLASK_PID=$!
    
    log_info "Starting React Frontend..."
    cd "$FRONTEND_DIR"
    npm start &
    REACT_PID=$!
    
    # Cleanup on exit
    cleanup() {
        log_info "Stopping processes..."
        kill $FLASK_PID
        kill $REACT_PID
        exit
    }
    trap cleanup SIGINT
    wait
    
else
    log_info "Starting in PRODUCTION mode..."
    
    # Build React App
    log_info "Building React Frontend..."
    cd "$FRONTEND_DIR"
    npm run build
    cd "$PROJECT_DIR"
    
    # Deploy Assets
    BUILD_DIR="$FRONTEND_DIR/build"
    TEMPLATE_DIR="$PROJECT_DIR/templates"
    STATIC_DIR="$PROJECT_DIR/static"
    
    if [ -d "$BUILD_DIR" ]; then
        log_info "Deploying build artifacts..."
        
        # Backup existing (optional, maybe overengineering for this script but good for safety)
        # cp -r "$TEMPLATE_DIR/index.html" "$TEMPLATE_DIR/index.html.bak" 2>/dev/null || true
        
        # Copy index.html
        cp "$BUILD_DIR/index.html" "$TEMPLATE_DIR/index.html"
        
        # Copy static assets (js, css, media)
        # Note: React build puts css/js in static/css and static/js. 
        # We need to merge them into Flask's static folder.
        cp -r "$BUILD_DIR/static/"* "$STATIC_DIR/"
        
        log_info "Build deployed successfully."
    else
        log_error "Build directory not found. Build failed?"
        exit 1
    fi
    
    # Check if port 3002 is already in use (e.g. by systemd service)
    if fuser 3002/tcp >/dev/null 2>&1; then
        log_info "Port 3002 is busy. Reloading existing server..."
        fuser -k -HUP 3002/tcp
        log_info "Server reloaded successfully."
        exit 0
    fi

    # Run Flask App (using Gunicorn if available, else python)
    if command -v gunicorn &> /dev/null; then
        log_info "Starting Server with Gunicorn..."
        # 1 worker, eventlet worker class for socketio support
        exec gunicorn --worker-class eventlet -w 1 --bind 0.0.0.0:3002 app:app
    else
        log_info "Gunicorn not found, starting with Python..."
        exec python app.py
    fi
fi
