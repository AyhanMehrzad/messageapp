import os

bind = "0.0.0.0:3002"
workers = 1
worker_class = "eventlet"
threads = 1
timeout = 120
keepalive = 5

# Logging
accesslog = "-"
errorlog = "-"
loglevel = "info"
