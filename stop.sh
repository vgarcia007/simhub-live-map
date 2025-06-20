#!/bin/bash

# Prüfe, ob PID-Datei existiert
if [ -f nfsh.pid ]; then
    PID=$(cat nfsh.pid)
    echo "Killing process $PID"
    kill "$PID"
    rm nfsh.pid
else
    echo "No PID file found. Trying to kill all 'app.py' instances..."
    pkill -f app.py
fi
