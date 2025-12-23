#!/bin/bash

# Exit on error
set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "Updating Frontend..."

# 1. Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# 2. Build React App
echo "Building React App..."
cd "$FRONTEND_DIR"
npm install
npm run build

# 3. Deploy Assets
echo "Deploying assets to Flask..."
# Remove old static files if they exist (careful not to delete uploads)
# We'll just overwrite/merge
cp -r build/static/* "$PROJECT_DIR/static/"
cp build/index.html "$PROJECT_DIR/templates/index.html"

echo "Frontend updated successfully!"
