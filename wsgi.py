import os
import sys
import eventlet
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    eventlet.monkey_patch()
    from nolove_server_8000 import app, socketio
    
    if __name__ == "__main__":
        try:
            port = int(os.environ.get("PORT", 8000))
            logger.info(f"Starting server on port {port}")
            socketio.run(app, host='0.0.0.0', port=port, debug=False)
        except Exception as e:
            logger.error(f"Error starting server: {e}")
            sys.exit(1)
except Exception as e:
    logger.error(f"Error during initialization: {e}")
    sys.exit(1) 