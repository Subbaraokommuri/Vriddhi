#!/bin/bash
# Add standard Node/NPM installation paths to the system environment
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

cd "$(dirname "$0")"
open http://localhost:3000
npm run dev

