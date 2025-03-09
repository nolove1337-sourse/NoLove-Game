"""
NoLove Game - Сервер
"""
from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import os
import random
import math
import time
import json
import threading

# Настройка Flask и Socket.IO
app = Flask(__name__, static_folder='.')
app.config['SECRET_KEY'] = 'secret!'
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet', logger=True, engineio_logger=True)

# Состояние игры
game_state = {
    'is_active': False,
    'current_multiplier': 1.00,
    'countdown_active': False,
    'time_to_start': 5,
    'players': [],
    'recent_games': [],
    'game_history': []
}

# Маршруты Flask
@app.route('/')
def index():
    return send_from_directory('.', 'nolove.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# События Socket.IO
@socketio.on('connect')
def handle_connect():
    print(f'Новое подключение: {request.sid}')
    # Отправляем текущее состояние
    emit('init_state', {
        'isActive': game_state['is_active'],
        'currentMultiplier': game_state['current_multiplier'],
        'countdownActive': game_state['countdown_active'],
        'timeToStart': game_state['time_to_start'],
        'recentGames': game_state['recent_games'],
        'players': [
            {
                'id': p['id'],
                'username': p['username'],
                'bet': p['bet'],
                'didCashOut': p.get('did_cash_out', False)
            } for p in game_state['players'] if p.get('in_game', False)
        ],
        'gameHistory': game_state['game_history']
    })

@socketio.on('register_player')
def handle_register_player(data):
    username = data.get('username', f'Гость{random.randint(100, 999)}')
    
    # Добавляем игрока
    player = {
        'id': request.sid,
        'username': username,
        'balance': 1000,
        'bet': 0,
        'in_game': False,
        'did_cash_out': False,
        'cash_out_multiplier': 0,
        'ready': False
    }
    
    game_state['players'].append(player)
    
    # Отправляем подтверждение
    emit('player_registered', {
        'id': player['id'],
        'username': player['username'],
        'balance': player['balance']
    })
    
    print(f'Игрок зарегистрирован: {username}')
    return {'success': True}

@socketio.on('place_bet')
def handle_place_bet(data):
    # Находим игрока
    player = next((p for p in game_state['players'] if p['id'] == request.sid), None)
    
    if not player:
        return {'error': 'Игрок не найден'}
    
    try:
        bet = int(data['bet'])
    except (ValueError, KeyError, TypeError):
        return {'error': 'Неверная сумма ставки'}
    
    if bet <= 0 or bet > player['balance']:
        return {'error': 'Недостаточно средств'}
    
    if game_state['is_active'] or game_state['countdown_active']:
        return {'error': 'Игра уже идет'}
    
    # Обновляем данные игрока
    player['bet'] = bet
    player['balance'] -= bet
    player['in_game'] = True
    player['did_cash_out'] = False
    player['cash_out_multiplier'] = 0
    player['ready'] = True
    
    # Отправляем подтверждение
    emit('bet_confirmed', {
        'bet': player['bet'],
        'balance': player['balance']
    })
    
    # Оповещаем всех
    socketio.emit('player_bet', {
        'id': player['id'],
        'username': player['username'],
        'bet': player['bet']
    })
    
    # Если первая ставка, начинаем отсчет
    if not game_state['countdown_active'] and not game_state['is_active']:
        start_countdown()
    
    return {'success': True}

@socketio.on('cash_out')
def handle_cash_out():
    if not game_state['is_active']:
        return
    
    player = next((p for p in game_state['players'] if p['id'] == request.sid), None)
    
    if not player or not player['in_game'] or player['did_cash_out']:
        return
    
    # Фиксируем выигрыш
    player['did_cash_out'] = True
    player['cash_out_multiplier'] = game_state['current_multiplier']
    winnings = math.floor(player['bet'] * player['cash_out_multiplier'])
    player['balance'] += winnings
    
    # Отправляем подтверждение
    emit('cash_out_confirmed', {
        'multiplier': player['cash_out_multiplier'],
        'winnings': winnings,
        'balance': player['balance']
    })
    
    # Оповещаем всех
    socketio.emit('player_cashed_out', {
        'id': player['id'],
        'username': player['username'],
        'bet': player['bet'],
        'multiplier': player['cash_out_multiplier'],
        'winnings': winnings
    })

@socketio.on('disconnect')
def handle_disconnect():
    for i, player in enumerate(game_state['players']):
        if player['id'] == request.sid:
            print(f'Игрок отключился: {player["username"]}')
            game_state['players'].pop(i)
            break

# Функции игры
def start_countdown():
    if game_state['countdown_active']:
        return
    
    game_state['countdown_active'] = True
    game_state['time_to_start'] = 5
    
    socketio.emit('countdown_start', {'timeLeft': game_state['time_to_start']})
    
    # Запускаем отсчет в отдельном потоке
    def countdown_thread():
        for i in range(game_state['time_to_start'], 0, -1):
            time.sleep(1)
            game_state['time_to_start'] = i
            socketio.emit('countdown_update', {'timeLeft': i})
        
        game_state['countdown_active'] = False
        start_game()
    
    threading.Thread(target=countdown_thread, daemon=True).start()

def start_game():
    game_state['is_active'] = True
    game_state['current_multiplier'] = 1.00
    
    # Определяем точку краха (от 1.1 до 15)
    crash_point = 1 + math.pow(random.random(), 0.65) * 14
    
    print(f'Новая игра начата. Точка краха: {crash_point:.2f}x')
    
    # Уведомляем о начале игры
    active_players = [
        {
            'id': p['id'],
            'username': p['username'],
            'bet': p['bet']
        }
        for p in game_state['players'] if p['in_game']
    ]
    
    socketio.emit('game_start', {'activePlayers': active_players})
    
    # Запускаем игру в отдельном потоке
    def game_thread():
        while game_state['is_active'] and game_state['current_multiplier'] < crash_point:
            time.sleep(0.1)
            
            # Увеличиваем множитель
            game_state['current_multiplier'] += random.random() * 0.05 + 0.01
            game_state['current_multiplier'] = round(game_state['current_multiplier'], 2)
            
            # Отправляем обновление
            socketio.emit('multiplier_update', {'multiplier': game_state['current_multiplier']})
        
        # Игра закончилась
        handle_crash(crash_point)
    
    threading.Thread(target=game_thread, daemon=True).start()

def handle_crash(crash_point):
    game_state['is_active'] = False
    
    # Сохраняем результат
    game_result = {
        'multiplier': crash_point,
        'timestamp': time.time(),
        'players': [
            {
                'username': p['username'],
                'bet': p['bet'],
                'didCashOut': p['did_cash_out'],
                'cashOutMultiplier': p.get('cash_out_multiplier', 0),
                'profit': (math.floor(p['bet'] * p['cash_out_multiplier']) - p['bet']) 
                         if p['did_cash_out'] else -p['bet']
            }
            for p in game_state['players'] if p['in_game']
        ]
    }
    
    # Обновляем историю
    game_state['recent_games'].insert(0, f"{crash_point:.2f}")
    if len(game_state['recent_games']) > 10:
        game_state['recent_games'].pop()
    
    game_state['game_history'].insert(0, game_result)
    if len(game_state['game_history']) > 50:
        game_state['game_history'].pop()
    
    # Оповещаем о крахе
    socketio.emit('game_crash', {
        'crashPoint': f"{crash_point:.2f}",
        'gameResult': game_result
    })
    
    # Сбрасываем статусы игроков
    for player in game_state['players']:
        if player.get('in_game', False):
            player['in_game'] = False
            player['bet'] = 0
            player['did_cash_out'] = False
            player['cash_out_multiplier'] = 0
    
    # Если есть игроки, запускаем новую игру через 3 секунды
    def next_game_timer():
        time.sleep(3)
        if any(p.get('ready', False) for p in game_state['players']):
            start_countdown()
    
    threading.Thread(target=next_game_timer, daemon=True).start()

if __name__ == "__main__":
    port = int(os.environ.get('PORT', 8000))
    print(f"\n{'='*50}")
    print(f"      NoLove Game - Сервер запущен на порту {port}")
    print(f"{'='*50}")
    socketio.run(app, host='0.0.0.0', port=port, debug=False) 