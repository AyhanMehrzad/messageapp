import os

bind = "127.0.0.1:5000"
workers = 1
worker_class = "eventlet"
threads = 1
timeout = 120
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
