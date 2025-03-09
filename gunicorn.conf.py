import multiprocessing

bind = "0.0.0.0:8000"
worker_class = "eventlet"
workers = 1
worker_connections = 1000
timeout = 300
keepalive = 2

errorlog = "-"
loglevel = "debug"
accesslog = "-"
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s"' 