const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Настройка HTTP заголовков
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.header('Pragma', 'no-cache');
  res.header('Expires', '0');
  next();
});

// Подключаем статические файлы
app.use(express.static(path.join(__dirname, '/')));

// Маршрут для главной страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Состояние игры
let gameState = {
  isActive: false,
  currentMultiplier: 1.00,
  countdownActive: false,
  timeToStart: 5,
  players: [],
  recentGames: [1.5, 2.1, 1.2, 3.7, 1.9],
  gameHistory: []
};

// Хранение активных соединений
let activeConnections = new Map();

// Запуск таймера обратного отсчета
function startCountdown() {
  if (gameState.countdownActive) return;
  
  gameState.countdownActive = true;
  gameState.timeToStart = 5;
  
  io.emit('countdown_start', { timeLeft: gameState.timeToStart });
  
  const countdownInterval = setInterval(() => {
    gameState.timeToStart--;
    io.emit('countdown_update', { timeLeft: gameState.timeToStart });
    
    if (gameState.timeToStart <= 0) {
      clearInterval(countdownInterval);
      gameState.countdownActive = false;
      startGame();
    }
  }, 1000);
}

// Запуск игры
function startGame() {
  gameState.isActive = true;
  gameState.currentMultiplier = 1.00;
  
  // Обнуляем состояние игроков перед началом игры
  gameState.players.forEach(player => {
    player.didCashOut = false;
    player.cashOutMultiplier = 0;
  });
  
  // Отправляем событие начала игры
  io.emit('game_start', { activePlayers: gameState.players });
  
  // Логирование начала игры
  console.log(`[GAME] Игра началась. Активных игроков: ${gameState.players.length}`);
  
  // Запускаем обновление множителя
  let gameInterval = setInterval(() => {
    gameState.currentMultiplier += 0.01;
    
    // Округляем до 2 знаков после запятой
    const roundedMultiplier = parseFloat(gameState.currentMultiplier.toFixed(2));
    
    // Отправляем обновление множителя
    io.emit('multiplier_update', { multiplier: roundedMultiplier });
    
    // Проверяем авто-выводы
    gameState.players.forEach(player => {
      if (!player.didCashOut && player.autoCashout && roundedMultiplier >= player.autoCashout) {
        playerCashOut(player.id, roundedMultiplier);
      }
    });
    
    // Рассчитываем вероятность краха
    // Формула дает низкую вероятность в начале и повышает с ростом множителя
    const crashProbability = Math.min((roundedMultiplier - 1) / 100, 0.05);
    
    if (Math.random() < crashProbability || roundedMultiplier >= 10) {
      clearInterval(gameInterval);
      handleCrash(roundedMultiplier);
    }
  }, 100);
}

// Обработка краха
function handleCrash(crashPoint) {
  // Округляем до 2 знаков после запятой
  crashPoint = parseFloat(crashPoint.toFixed(2));
  
  // Логирование краха
  console.log(`[CRASH] Игра завершилась крахом при x${crashPoint}`);
  
  // Обновляем состояние игры
  gameState.isActive = false;
  
  // Добавляем результат в историю
  gameState.recentGames.unshift(crashPoint);
  if (gameState.recentGames.length > 5) {
    gameState.recentGames.pop();
  }
  
  // Сохраняем результаты игры
  const gameResult = {
    multiplier: crashPoint,
    players: gameState.players.map(player => ({
      username: player.username,
      bet: player.bet,
      didCashOut: player.didCashOut,
      cashOutMultiplier: player.didCashOut ? player.cashOutMultiplier : 0
    }))
  };
  
  gameState.gameHistory.unshift(gameResult);
  if (gameState.gameHistory.length > 10) {
    gameState.gameHistory.pop();
  }
  
  // Отправляем событие краха
  io.emit('game_crash', {
    crashPoint: crashPoint,
    gameResult: gameResult
  });
  
  // Обновляем список активных игроков (удаляем тех, кто сделал ставку)
  gameState.players = gameState.players.filter(player => !player.bet);
  
  // Запускаем новую игру через 3 секунды
  setTimeout(() => {
    startCountdown();
  }, 3000);
}

// Функция для обработки вывода игрока
function playerCashOut(playerId, currentMultiplier) {
  const playerIndex = gameState.players.findIndex(p => p.id === playerId);
  
  if (playerIndex === -1) return false;
  
  const player = gameState.players[playerIndex];
  
  // Проверяем, может ли игрок вывести средства
  if (player.didCashOut || !player.bet) return false;
  
  // Отмечаем, что игрок вывел средства
  player.didCashOut = true;
  player.cashOutMultiplier = currentMultiplier;
  
  // Обновляем баланс игрока
  const winnings = Math.floor(player.bet * currentMultiplier);
  player.balance += winnings;
  
  // Получаем сокет игрока
  const socket = activeConnections.get(playerId);
  
  if (socket) {
    // Отправляем подтверждение вывода игроку
    socket.emit('cash_out_confirmed', {
      multiplier: currentMultiplier,
      winnings: winnings,
      balance: player.balance
    });
    
    // Уведомляем всех остальных игроков
    socket.broadcast.emit('player_cashed_out', {
      id: player.id,
      username: player.username,
      multiplier: currentMultiplier,
      winnings: winnings
    });
  }
  
  console.log(`[CASH OUT] Игрок ${player.username} вывел при x${currentMultiplier}. Выигрыш: ${winnings}`);
  
  return true;
}

// Подключение нового клиента
io.on('connection', (socket) => {
  console.log(`[CONNECT] Новое подключение: ${socket.id}`);
  
  // Отправляем текущее состояние игры
  socket.emit('init_state', {
    recentGames: gameState.recentGames,
    gameHistory: gameState.gameHistory,
    isActive: gameState.isActive,
    countdownActive: gameState.countdownActive,
    timeToStart: gameState.timeToStart,
    currentMultiplier: gameState.currentMultiplier,
    players: gameState.players
  });
  
  // Регистрация игрока
  socket.on('register_player', (data, callback) => {
    try {
      // Проверка данных
      if (!data.username || data.username.trim() === '') {
        return callback && callback({ error: 'Имя пользователя не может быть пустым' });
      }
      
      // Создаем игрока
      const player = {
        id: socket.id,
        username: data.username.substring(0, 15), // Ограничиваем длину имени
        balance: 1000,
        bet: 0,
        didCashOut: false,
        cashOutMultiplier: 0,
        autoCashout: 0
      };
      
      // Добавляем игрока в список
      gameState.players.push(player);
      activeConnections.set(player.id, socket);
      
      // Отправляем подтверждение регистрации
      socket.emit('player_registered', {
        id: player.id,
        username: player.username,
        balance: player.balance
      });
      
      // Уведомляем других игроков
      socket.broadcast.emit('chat_message', {
        username: 'Система',
        message: `${player.username} присоединился к игре`
      });
      
      // Отвечаем на callback
      if (callback) callback({ success: true });
      
      console.log(`[REGISTER] Игрок зарегистрирован: ${player.username}`);
      
      // Если еще нет активной игры или обратного отсчета, начинаем новую игру
      if (!gameState.isActive && !gameState.countdownActive) {
        startCountdown();
      }
    } catch (error) {
      console.error('[ERROR] Ошибка при регистрации игрока:', error);
      if (callback) callback({ error: 'Ошибка при регистрации' });
    }
  });
  
  // Размещение ставки
  socket.on('place_bet', (data, callback) => {
    try {
      // Проверка данных
      if (!data.bet || isNaN(data.bet) || data.bet <= 0) {
        return callback && callback({ error: 'Некорректная ставка' });
      }
      
      // Находим игрока
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex === -1) {
        return callback && callback({ error: 'Пользователь не найден' });
      }
      
      const player = gameState.players[playerIndex];
      
      // Проверяем, не идет ли уже игра
      if (gameState.isActive) {
        return callback && callback({ error: 'Невозможно сделать ставку во время активной игры' });
      }
      
      // Проверяем достаточно ли средств
      if (data.bet > player.balance) {
        return callback && callback({ error: 'Недостаточно средств' });
      }
      
      // Обновляем данные игрока
      player.bet = parseInt(data.bet);
      player.balance -= player.bet;
      player.didCashOut = false;
      player.cashOutMultiplier = 0;
      
      // Подтверждаем ставку
      socket.emit('bet_confirmed', {
        bet: player.bet,
        balance: player.balance
      });
      
      // Уведомляем других игроков
      socket.broadcast.emit('player_bet', {
        id: player.id,
        username: player.username,
        bet: player.bet
      });
      
      console.log(`[BET] Игрок ${player.username} сделал ставку: ${player.bet}`);
      
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('[ERROR] Ошибка при размещении ставки:', error);
      if (callback) callback({ error: 'Ошибка при размещении ставки' });
    }
  });
  
  // Вывод средств
  socket.on('cash_out', (data, callback) => {
    try {
      // Проверяем, идет ли игра
      if (!gameState.isActive) {
        return callback && callback({ error: 'Игра не активна' });
      }
      
      // Находим игрока
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex === -1) {
        return callback && callback({ error: 'Пользователь не найден' });
      }
      
      const player = gameState.players[playerIndex];
      
      // Вызываем функцию вывода средств
      const result = playerCashOut(player.id, gameState.currentMultiplier);
      
      if (callback) callback({ success: result });
    } catch (error) {
      console.error('[ERROR] Ошибка при выводе средств:', error);
      if (callback) callback({ error: 'Ошибка при выводе средств' });
    }
  });
  
  // Настройка авто-вывода
  socket.on('set_auto_cashout', (data, callback) => {
    try {
      if (!data.multiplier || isNaN(data.multiplier) || data.multiplier < 1) {
        return callback && callback({ error: 'Некорректный множитель' });
      }
      
      // Находим игрока
      const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex === -1) {
        return callback && callback({ error: 'Пользователь не найден' });
      }
      
      // Устанавливаем авто-вывод
      gameState.players[playerIndex].autoCashout = parseFloat(data.multiplier);
      
      if (callback) callback({ success: true });
    } catch (error) {
      console.error('[ERROR] Ошибка при настройке авто-вывода:', error);
      if (callback) callback({ error: 'Ошибка при настройке авто-вывода' });
    }
  });
  
  // Сообщение в чате
  socket.on('chat_message', (data) => {
    try {
      // Находим игрока
      const player = gameState.players.find(p => p.id === socket.id);
      
      if (!player) return;
      
      // Фильтруем и обрезаем сообщение
      const message = (data.message || '').substring(0, 200).trim();
      
      if (message === '') return;
      
      // Отправляем сообщение всем
      io.emit('chat_message', {
        username: player.username,
        message: message
      });
      
      console.log(`[CHAT] ${player.username}: ${message}`);
    } catch (error) {
      console.error('[ERROR] Ошибка при отправке сообщения:', error);
    }
  });
  
  // Отключение клиента
  socket.on('disconnect', () => {
    // Удаляем игрока из списка активных соединений
    activeConnections.delete(socket.id);
    
    // Находим игрока
    const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
    
    if (playerIndex !== -1) {
      const player = gameState.players[playerIndex];
      
      // Если игрок не сделал ставку, удаляем его из списка
      if (!gameState.isActive || !player.bet) {
        gameState.players.splice(playerIndex, 1);
      }
      
      // Уведомляем других игроков
      socket.broadcast.emit('chat_message', {
        username: 'Система',
        message: `${player.username} покинул игру`
      });
      
      console.log(`[DISCONNECT] Игрок отключился: ${player.username}`);
    } else {
      console.log(`[DISCONNECT] Соединение закрыто: ${socket.id}`);
    }
  });
});

// Запуск сервера
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`[SERVER] Сервер запущен на порту ${PORT}`);
  console.log(`[SERVER] Откройте в браузере: http://localhost:${PORT}`);
}); 