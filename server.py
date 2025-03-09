from flask import Flask, render_template, send_from_directory, after_this_request
from flask_socketio import SocketIO, emit, request
import os
import random
import math
import time
import json

# Обновляем настройки приложения
app = Flask(__name__, static_folder='.', static_url_path='')
app.config['SECRET_KEY'] = 'secret!'
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # Отключаем кэширование
socketio = SocketIO(app, cors_allowed_origins='*')

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
    @after_this_request
    def add_header(response):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
    return send_from_directory('.', 'nolove.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

# События Socket.IO
@socketio.on('connect')
def handle_connect():
    print(f'Новое подключение: {request.sid}')
    # Отправляем текущее состояние игры новому клиенту
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
                'didCashOut': p['did_cash_out']
            } for p in game_state['players'] if p['in_game']
        ],
        'gameHistory': game_state['game_history']
    })

@socketio.on('register_player')
def handle_register_player(data):
    # Проверка данных
    if not data or 'username' not in data or not data['username'].strip():
        return {'error': 'Некорректное имя пользователя'}
    
    username = data['username'].strip()
    
    # Проверка на дублирование имени
    for player in game_state['players']:
        if player['username'] == username:
            return {'error': 'Имя пользователя уже занято'}
    
    initial_balance = 1000
    
    # Добавляем игрока
    game_state['players'].append({
        'id': request.sid,
        'username': username,
        'balance': initial_balance,
        'bet': 0,
        'in_game': False,
        'did_cash_out': False,
        'cash_out_multiplier': 0,
        'ready': False
    })
    
    # Отправляем подтверждение
    emit('player_registered', {
        'id': request.sid,
        'username': username,
        'balance': initial_balance
    })
    
    print(f'Игрок зарегистрирован: {username} ({request.sid})')
    return {'success': True}

@socketio.on('place_bet')
def handle_place_bet(data):
    # Находим игрока
    player = None
    for p in game_state['players']:
        if p['id'] == request.sid:
            player = p
            break
    
    if not player:
        print(f'Ставка отклонена: игрок не найден, ID: {request.sid}')
        return {'error': 'Пользователь не зарегистрирован'}
    
    try:
        bet = int(data['bet'])
    except (TypeError, ValueError, KeyError):
        print('Ставка отклонена: некорректная сумма')
        return {'error': 'Неверная сумма ставки'}
    
    if bet <= 0:
        print('Ставка отклонена: ставка должна быть больше 0')
        return {'error': 'Ставка должна быть больше 0'}
    
    if bet > player['balance']:
        print(f'Ставка отклонена: недостаточно средств {bet} > {player["balance"]}')
        return {'error': 'Недостаточно средств'}
    
    if game_state['is_active'] or game_state['countdown_active']:
        print('Ставка отклонена: игра уже идет')
        return {'error': 'Ставки на текущую игру закрыты'}
    
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
    
    print(f'Ставка принята: {player["username"]} поставил {bet}')
    
    # Оповещаем всех о новой ставке
    socketio.emit('player_bet', {
        'id': player['id'],
        'username': player['username'],
        'bet': player['bet']
    })
    
    # Если это первая ставка, начинаем отсчет
    if not game_state['countdown_active'] and not game_state['is_active']:
        start_countdown()
    
    return {'success': True}

@socketio.on('cash_out')
def handle_cash_out():
    if not game_state['is_active']:
        return
    
    player = None
    for p in game_state['players']:
        if p['id'] == request.sid:
            player = p
            break
    
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
    
    print(f'Игрок {player["username"]} вывел при множителе {player["cash_out_multiplier"]}x и выиграл {winnings}')

@socketio.on('set_auto_cashout')
def handle_set_auto_cashout(data):
    player = None
    for p in game_state['players']:
        if p['id'] == request.sid:
            player = p
            break
    
    if not player:
        return
    
    try:
        player['auto_cashout_multiplier'] = float(data['multiplier'])
        emit('auto_cashout_set', {
            'multiplier': player['auto_cashout_multiplier']
        })
    except (TypeError, ValueError, KeyError):
        pass

@socketio.on('chat_message')
def handle_chat_message(data):
    player = None
    for p in game_state['players']:
        if p['id'] == request.sid:
            player = p
            break
    
    if not player or 'message' not in data:
        return
    
    socketio.emit('chat_message', {
        'username': player['username'],
        'message': data['message']
    })

@socketio.on('disconnect')
def handle_disconnect():
    player_index = -1
    for i, p in enumerate(game_state['players']):
        if p['id'] == request.sid:
            player_index = i
            break
    
    if player_index != -1:
        player = game_state['players'][player_index]
        print(f'Игрок отключился: {player["username"]} ({request.sid})')
        game_state['players'].pop(player_index)

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
    
    import threading
    thread = threading.Thread(target=countdown_thread)
    thread.daemon = True
    thread.start()

def start_game():
    game_state['is_active'] = True
    game_state['current_multiplier'] = 1.00
    
    # Определяем точку краха (от 1.1 до 15)
    crash_point = 1 + math.pow(random.random(), 0.65) * 14
    
    print(f'Новая игра начата. Точка краха: {crash_point:.2f}x')
    
    # Список активных игроков
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
            time.sleep(0.1)  # Обновляем каждые 100 мс
            
            # Увеличиваем множитель
            game_state['current_multiplier'] += random.random() * 0.05 + 0.01
            game_state['current_multiplier'] = round(game_state['current_multiplier'], 2)
            
            # Отправляем обновление
            socketio.emit('multiplier_update', {'multiplier': game_state['current_multiplier']})
            
            # Проверяем авто-вывод для каждого игрока
            for player in game_state['players']:
                if player['in_game'] and not player['did_cash_out'] and 'auto_cashout_multiplier' in player:
                    if game_state['current_multiplier'] >= player['auto_cashout_multiplier']:
                        player['did_cash_out'] = True
                        player['cash_out_multiplier'] = game_state['current_multiplier']
                        winnings = math.floor(player['bet'] * player['cash_out_multiplier'])
                        player['balance'] += winnings
                        
                        socketio.emit('cash_out_confirmed', {
                            'multiplier': player['cash_out_multiplier'],
                            'winnings': winnings,
                            'balance': player['balance']
                        }, to=player['id'])
                        
                        socketio.emit('player_cashed_out', {
                            'id': player['id'],
                            'username': player['username'],
                            'bet': player['bet'],
                            'multiplier': player['cash_out_multiplier'],
                            'winnings': winnings
                        })
        
        # Игра закончилась
        handle_crash(crash_point)
    
    import threading
    thread = threading.Thread(target=game_thread)
    thread.daemon = True
    thread.start()

def handle_crash(crash_point):
    game_state['is_active'] = False
    
    # Сохраняем результат игры
    game_result = {
        'multiplier': crash_point,
        'timestamp': time.time(),
        'players': [
            {
                'username': p['username'],
                'bet': p['bet'],
                'didCashOut': p['did_cash_out'],
                'cashOutMultiplier': p['cash_out_multiplier'],
                'profit': math.floor(p['bet'] * p['cash_out_multiplier']) - p['bet'] if p['did_cash_out'] else -p['bet']
            }
            for p in game_state['players'] if p['in_game']
        ]
    }
    
    # Добавляем в историю
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
    
    # Сбрасываем состояние игроков
    for player in game_state['players']:
        if player['in_game']:
            player['in_game'] = False
            player['bet'] = 0
            player['did_cash_out'] = False
            player['cash_out_multiplier'] = 0
    
    # Если есть готовые игроки, запускаем новый отсчет
    def start_new_game():
        time.sleep(3)
        if any(p['ready'] for p in game_state['players']):
            start_countdown()
    
    import threading
    thread = threading.Thread(target=start_new_game)
    thread.daemon = True
    thread.start()

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=3000, debug=True) 