@echo off
title NoLove Game Server
echo ========================================================
echo                     NoLove Game Server
echo ========================================================
echo.
echo Запуск сервера на порту 8000...
echo.

:: Запускаем сервер
python start_nolove.py

:: В случае ошибки
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ошибка при запуске сервера! Код ошибки: %ERRORLEVEL%
    echo Попробуйте выполнить следующие шаги вручную:
    echo 1. Установите Python 3.7 или выше с https://python.org
    echo 2. Откройте командную строку в этой папке
    echo 3. Выполните команду: pip install -r requirements.txt
    echo 4. Выполните команду: python run.py
    echo.
    echo После запуска сервера откройте в браузере: http://localhost:8000
    echo.
    pause
) 