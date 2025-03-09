#!/bin/bash

echo "========================================================"
echo "                  NoLove Game Server"
echo "========================================================"
echo ""
echo "Запуск сервера на порту 8000..."
echo ""

# Попытка запустить с python3
if command -v python3 &>/dev/null; then
    python3 start_nolove.py
# Если python3 не найден, пробуем python
elif command -v python &>/dev/null; then
    python start_nolove.py
else
    echo "ОШИБКА: Python не найден. Установите Python 3.7 или выше."
    echo "Затем выполните команды:"
    echo "  pip install -r requirements.txt"
    echo "  python run.py"
    echo ""
    echo "После запуска сервера откройте в браузере: http://localhost:8000"
    exit 1
fi 