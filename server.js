const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Подключаем статические файлы
app.use(express.static(path.join(__dirname, '/')));

// Состояние игры
let gameState = {
  isActive: false,
  currentMultiplier: 1.00,
  countdownActive: false,
  timeToStart: 5,
  players: [],
  recentGames: [],
  gameHistory: []
};

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
  
  // Определяем точку краха (от 1.1 до 15)
  const crashPoint = 1 + Math.pow(Math.random(), 0.65) * 14;
  
  console.log(`New game started. Crash point: ${crashPoint.toFixed(2)}x`);
  
  io.emit('game_start', { 
    activePlayers: gameState.players.filter(p => p.inGame).map(p => ({ 
      id: p.id, 
      username: p.username, 
      bet: p.bet 
    })) 
  });
  
  // Интервал для обновления множителя
  const gameInterval = setInterval(() => {
    // Увеличиваем множитель
    gameState.currentMultiplier += Math.random() * 0.05 + 0.01;
    gameState.currentMultiplier = parseFloat(gameState.currentMultiplier.toFixed(2));
    
    // Отправляем обновление клиентам
    io.emit('multiplier_update', { multiplier: gameState.currentMultiplier });
    
    // Проверяем, не достигли ли точки краха
    if (gameState.currentMultiplier >= crashPoint) {
      clearInterval(gameInterval);
      handleCrash(crashPoint);
    }
  }, 100);
}

// Обработка краха
function handleCrash(crashPoint) {
  gameState.isActive = false;
  
  // Сохраняем результат игры
  const gameResult = {
    multiplier: crashPoint,
    timestamp: Date.now(),
    players: gameState.players.filter(p => p.inGame).map(p => ({
      username: p.username,
      bet: p.bet,
      didCashOut: p.didCashOut,
      cashOutMultiplier: p.cashOutMultiplier,
      profit: p.didCashOut ? Math.floor(p.bet * p.cashOutMultiplier) - p.bet : -p.bet
    }))
  };
  
  gameState.recentGames.unshift(crashPoint.toFixed(2));
  if (gameState.recentGames.length > 10) {
    gameState.recentGames.pop();
  }
  
  gameState.gameHistory.unshift(gameResult);
  if (gameState.gameHistory.length > 50) {
    gameState.gameHistory.pop();
  }
  
  // Уведомляем клиентов о крахе
  io.emit('game_crash', { 
    crashPoint: crashPoint.toFixed(2),
    gameResult: gameResult
  });
  
  // Сбрасываем состояние игроков для следующей игры
  gameState.players.forEach(player => {
    if (player.inGame) {
      player.inGame = false;
      player.bet = 0;
      player.didCashOut = false;
      player.cashOutMultiplier = 0;
    }
  });
  
  // Если есть готовые игроки, запускаем новый отсчет
  setTimeout(() => {
    if (gameState.players.some(p => p.ready)) {
      startCountdown();
    }
  }, 3000);
}

// Обработка подключений через Socket.IO
io.on('connection', (socket) => {
  console.log(`Новое подключение: ${socket.id}`);
  
  // Отправляем текущее состояние игры новому клиенту
  socket.emit('init_state', {
    isActive: gameState.isActive,
    currentMultiplier: gameState.currentMultiplier,
    countdownActive: gameState.countdownActive,
    timeToStart: gameState.timeToStart,
    recentGames: gameState.recentGames,
    players: gameState.players.filter(p => p.inGame).map(p => ({
      id: p.id,
      username: p.username,
      bet: p.bet,
      didCashOut: p.didCashOut
    })),
    gameHistory: gameState.gameHistory
  });
  
  // Регистрация нового игрока
  socket.on('register_player', (data, callback) => {
    // Проверяем правильность данных
    if (!data || !data.username || typeof data.username !== 'string' || data.username.trim() === '') {
      console.log('Ошибка регистрации: некорректное имя пользователя');
      if (callback) callback({ error: 'Некорректное имя пользователя' });
      return;
    }
    
    const username = data.username.trim();
    
    // Проверяем, не занято ли имя
    const existingPlayer = gameState.players.find(p => p.username === username);
    if (existingPlayer) {
      console.log('Ошибка регистрации: имя пользователя уже занято', username);
      if (callback) callback({ error: 'Имя пользователя уже занято' });
      return;
    }
    
    const initialBalance = 1000;
    
    // Добавляем игрока в список
    gameState.players.push({
      id: socket.id,
      username: username,
      balance: initialBalance,
      bet: 0,
      inGame: false,
      didCashOut: false,
      cashOutMultiplier: 0,
      ready: false
    });
    
    // Отвечаем с подтверждением
    socket.emit('player_registered', {
      id: socket.id,
      username: username,
      balance: initialBalance
    });
    
    // Успешный ответ через колбэк
    if (callback) callback({ success: true });
    
    console.log(`Игрок зарегистрирован: ${username} (${socket.id})`);
  });
  
  // Игрок делает ставку
  socket.on('place_bet', (data, callback) => {
    const player = gameState.players.find(p => p.id === socket.id);
    
    // Проверяем, найден ли игрок
    if (!player) {
      console.log('Ставка отклонена: игрок не найден, ID:', socket.id);
      if (callback) callback({ error: 'Пользователь не зарегистрирован' });
      return;
    }
    
    const bet = parseInt(data.bet);
    
    // Проверяем корректность ставки
    if (isNaN(bet) || bet <= 0) {
      console.log('Ставка отклонена: некорректная сумма', bet);
      if (callback) callback({ error: 'Неверная сумма ставки' });
      return;
    }
    
    // Проверяем достаточно ли средств
    if (bet > player.balance) {
      console.log('Ставка отклонена: недостаточно средств', bet, player.balance);
      if (callback) callback({ error: 'Недостаточно средств' });
      return;
    }
    
    // Если игра активна или идет обратный отсчет, не принимаем ставки
    if (gameState.isActive || gameState.countdownActive) {
      console.log('Ставка отклонена: игра уже идет');
      if (callback) callback({ error: 'Ставки на текущую игру закрыты' });
      return;
    }
    
    // Обновляем данные игрока
    player.bet = bet;
    player.balance -= bet;
    player.inGame = true;
    player.didCashOut = false;
    player.cashOutMultiplier = 0;
    player.ready = true;
    
    // Уведомляем клиента о принятой ставке
    socket.emit('bet_confirmed', {
      bet: player.bet,
      balance: player.balance
    });
    
    // Отправляем успешный ответ через колбэк
    if (callback) callback({ success: true });
    
    console.log(`Ставка принята: ${player.username} поставил ${bet}`);
    
    // Уведомляем всех о новой ставке
    io.emit('player_bet', {
      id: player.id,
      username: player.username,
      bet: player.bet
    });
    
    // Если это первая ставка, начинаем отсчет
    if (!gameState.countdownActive && !gameState.isActive) {
      startCountdown();
    }
  });
  
  // Игрок забирает выигрыш
  socket.on('cash_out', () => {
    if (!gameState.isActive) return;
    
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player || !player.inGame || player.didCashOut) return;
    
    // Фиксируем выигрыш
    player.didCashOut = true;
    player.cashOutMultiplier = gameState.currentMultiplier;
    const winnings = Math.floor(player.bet * player.cashOutMultiplier);
    player.balance += winnings;
    
    // Уведомляем игрока о выигрыше
    socket.emit('cash_out_confirmed', {
      multiplier: player.cashOutMultiplier,
      winnings: winnings,
      balance: player.balance
    });
    
    // Уведомляем всех о выигрыше игрока
    io.emit('player_cashed_out', {
      id: player.id,
      username: player.username,
      bet: player.bet,
      multiplier: player.cashOutMultiplier,
      winnings: winnings
    });
    
    console.log(`Игрок ${player.username} вывел при множителе ${player.cashOutMultiplier}x и выиграл ${winnings}`);
  });
  
  // Авто-вывод
  socket.on('set_auto_cashout', (data) => {
    const player = gameState.players.find(p => p.id === socket.id);
    if (!player) return;
    
    player.autoCashoutMultiplier = parseFloat(data.multiplier);
    
    socket.emit('auto_cashout_set', {
      multiplier: player.autoCashoutMultiplier
    });
  });
  
  // Отключение игрока
  socket.on('disconnect', () => {
    const playerIndex = gameState.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      const player = gameState.players[playerIndex];
      console.log(`Игрок отключился: ${player.username} (${socket.id})`);
      gameState.players.splice(playerIndex, 1);
    }
  });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
}); 