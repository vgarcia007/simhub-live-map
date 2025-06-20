#!/bin/bash

# Pfad zur Logdatei
LOGFILE="nfsh.log"

# Starte die App im Hintergrund und schreibe die PID in eine Datei
echo "Starting NFSH Flask App..."
nohup python3 app.py > "$LOGFILE" 2>&1 & echo $! > nfsh.pid
echo "Started with PID $(cat nfsh.pid), logging to $LOGFILE"
