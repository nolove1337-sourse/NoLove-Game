import eventlet
eventlet.monkey_patch()

from nolove_server_8000 import app, socketio

if __name__ == "__main__":
    socketio.run(app, host='0.0.0.0', port=8000) 