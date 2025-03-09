from server import app, socketio
import webbrowser
import threading
import time
import os
import platform

def open_browser():
    """Открывает браузер после задержки"""
    time.sleep(2)  # Даем серверу время запуститься
    webbrowser.open('http://localhost:8000')

if __name__ == "__main__":
    print("Запуск сервера NoLove Game...")
    print("Через несколько секунд откроется браузер")
    print("Если браузер не открылся, перейдите по адресу: http://localhost:8000")
    
    # Запуск браузера в отдельном потоке
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Запуск сервера
    socketio.run(app, host='0.0.0.0', port=8000, debug=False) 