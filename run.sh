#!/usr/bin/env sh
# Start AEROLYTICS locally, then open http://localhost:8000
cd "$(dirname "$0")" && python3 -m uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
