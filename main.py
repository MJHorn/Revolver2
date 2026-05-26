#!/usr/bin/env python3
"""
Revolver - local launcher script.
Hosts the visualizer files on a lightweight HTTP server and opens it in the browser.
"""

import http.server
import socketserver
import webbrowser
import threading
import sys
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Silence standard requests logging to keep the console clean
        pass

def open_browser():
    try:
        # Wait a brief moment for the server to spin up
        threading.Event().wait(0.8)
        url = f"http://localhost:{PORT}"
        print(f"-> Launching default web browser to {url}...")
        webbrowser.open(url)
    except Exception as e:
        print(f"Warning: Could not automatically open browser: {e}")

def run_server():
    # Allow address reuse to avoid port blockages on restart
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), Handler) as httpd:
            print("==================================================================")
            print("  REVOLVER: 3D Volumes & Surfaces of Revolution Visualizer")
            print("==================================================================")
            print(f"  Local Server: Running on http://localhost:{PORT}")
            print("  Workspace:    " + DIRECTORY)
            print("  Shutdown:     Press Ctrl+C to stop the server")
            print("==================================================================")
            
            # Start browser launch thread
            threading.Thread(target=open_browser, daemon=True).start()
            
            # Run server
            httpd.serve_forever()
            
    except OSError as e:
        print(f"\nError starting server on port {PORT}: {e}")
        print("Tip: A server might already be running on this port. Try closing other instances.")
    except KeyboardInterrupt:
        print("\nServer stopped by user. Goodbye!")
        sys.exit(0)

if __name__ == "__main__":
    run_server()

