import os
import sys
import platform
import subprocess
import time

def kill_process_on_port(port):
    """Останавливает процесс, который использует указанный порт"""
    system = platform.system()
    
    try:
        if system == "Windows":
            # Для Windows
            result = subprocess.run(f"netstat -ano | findstr :{port}", shell=True, capture_output=True, text=True)
            lines = result.stdout.strip().split('\n')
            
            for line in lines:
                parts = line.split()
                if len(parts) > 4 and "LISTENING" in line:
                    pid = parts[-1]
                    print(f"Найден процесс (PID: {pid}) на порту {port}. Пытаюсь остановить...")
                    try:
                        subprocess.run(f"taskkill /F /PID {pid}", shell=True)
                        print(f"Процесс с PID {pid} остановлен.")
                    except Exception as e:
                        print(f"Ошибка при остановке процесса: {e}")
        else:
            # Для Linux/Mac
            result = subprocess.run(f"lsof -i :{port} -t", shell=True, capture_output=True, text=True)
            pids = result.stdout.strip().split('\n')
            
            for pid in pids:
                if pid:
                    print(f"Найден процесс (PID: {pid}) на порту {port}. Пытаюсь остановить...")
                    try:
                        subprocess.run(f"kill -9 {pid}", shell=True)
                        print(f"Процесс с PID {pid} остановлен.")
                    except Exception as e:
                        print(f"Ошибка при остановке процесса: {e}")
    except Exception as e:
        print(f"Ошибка при поиске процессов: {e}")

def start_server():
    """Запускает сервер NoLove"""
    print("="*50)
    print("ЗАПУСК СЕРВЕРА NOLOVE")
    print("="*50)
    print("1. Проверка наличия Python...")
    
    # Проверка наличия Python
    try:
        python_version = subprocess.run(["python", "--version"], capture_output=True, text=True)
        print(f"  Найден: {python_version.stdout.strip()}")
    except:
        try:
            python_version = subprocess.run(["python3", "--version"], capture_output=True, text=True)
            print(f"  Найден: {python_version.stdout.strip()}")
            python_cmd = "python3"
        except:
            print("  ОШИБКА: Python не найден! Установите Python 3.7 или выше.")
            return
    
    python_cmd = "python"
    
    # Проверка наличия зависимостей
    print("\n2. Проверка и установка зависимостей...")
    try:
        subprocess.run([python_cmd, "-m", "pip", "install", "-r", "requirements.txt"], check=True)
        print("  Зависимости установлены успешно!")
    except Exception as e:
        print(f"  ОШИБКА при установке зависимостей: {e}")
        return
    
    # Остановка процессов на порту 8000
    print("\n3. Освобождение порта 8000...")
    kill_process_on_port(8000)
    
    # Запуск сервера
    print("\n4. Запуск сервера NoLove...")
    print("\nОткройте в браузере: http://localhost:8000")
    print("Для остановки сервера нажмите Ctrl+C")
    print("="*50 + "\n")
    
    os.system(f"{python_cmd} run.py")

if __name__ == "__main__":
    start_server() 