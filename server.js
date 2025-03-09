const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const cors = require('cors');

// Создаем приложение Express
const app = express();
const server = http.createServer(app);

// Настройка CORS
app.use(cors());

// Настройка Socket.IO с широкими CORS-настройками
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["*"],
    credentials: true
  }
});

// Обслуживание статических файлов
app.use(express.static(path.join(__dirname)));

// Базовый маршрут
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Информационный маршрут для проверки статуса
app.get('/status', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', players: Object.keys(gameState.players).length });
});

// Состояние игры
const gameState = {
  isActive: false,
  currentMultiplier: 1.0,
  players: {},
  history: [],
  recentGames: []
};

// Игровые интервалы
let countdownInterval = null;
let gameInterval = null;

// Обработка подключений Socket.IO
io.on('connection', (socket) => {
  console.log(`[SOCKET] Новое подключение: ${socket.id}`);

  // Отправляем текущее состояние игры
  function sendInitialState() {
    socket.emit('init_state', {
      isActive: gameState.isActive,
      currentMultiplier: gameState.currentMultiplier,
      players: Object.values(gameState.players),
      recentGames: gameState.recentGames,
      gameHistory: gameState.history,
      countdownActive: countdownInterval !== null,
      timeToStart: countdownInterval !== null ? 5 : 0
    });
  }

  // Отправляем начальное состояние
  sendInitialState();

  // Регистрация игрока
  socket.on('register_player', (data, callback) => {
    console.log(`[PLAYER] Регистрация игрока: ${data.username}`);
    
    try {
      const playerId = socket.id;
      
      // Создаем игрока
      gameState.players[playerId] = {
        id: playerId,
        username: data.username,
        balance: 1000,
        bet: 0,
        didCashOut: false,
        cashOutMultiplier: 0,
        inGame: false
      };
      
      // Отвечаем клиенту
      if (callback) {
        callback({ 
          success: true, 
          id: playerId, 
          username: data.username, 
          balance: 1000
        });
      }
      
      // Оповещаем всех о новом игроке
      io.emit('player_joined', {
        id: playerId,
        username: data.username
      });
      
      // Если нет активной игры и нет обратного отсчета, начинаем новый раунд
      if (!gameState.isActive && countdownInterval === null) {
        startCountdown();
      }
    } catch (error) {
      console.error('[ERROR] Ошибка при регистрации игрока:', error);
      if (callback) callback({ success: false, error: 'Ошибка регистрации' });
    }
  });

  // Ставка
  socket.on('place_bet', (data, callback) => {
    try {
      const playerId = socket.id;
      const player = gameState.players[playerId];
      
      if (!player) {
        if (callback) callback({ success: false, error: 'Игрок не найден' });
        return;
      }
      
      if (gameState.isActive) {
        if (callback) callback({ success: false, error: 'Игра уже началась' });
        return;
      }
      
      const betAmount = parseFloat(data.bet);
      
      if (isNaN(betAmount) || betAmount <= 0) {
        if (callback) callback({ success: false, error: 'Неверная сумма ставки' });
        return;
      }
      
      if (betAmount > player.balance) {
        if (callback) callback({ success: false, error: 'Недостаточно средств' });
        return;
      }
      
      // Устанавливаем ставку
      player.bet = betAmount;
      player.balance -= betAmount;
      player.inGame = true;
      player.didCashOut = false;
      player.cashOutMultiplier = 0;
      
      console.log(`[BET] Игрок ${player.username} сделал ставку ${betAmount}`);
      
      // Отвечаем клиенту
      if (callback) {
        callback({ 
          success: true, 
          bet: betAmount, 
          balance: player.balance 
        });
      }
      
      // Оповещаем всех о ставке
      io.emit('player_bet', {
        id: playerId,
        username: player.username,
        bet: betAmount
      });
      
      // Если нет активной игры и нет обратного отсчета, начинаем новый раунд
      if (!gameState.isActive && countdownInterval === null) {
        startCountdown();
      }
    } catch (error) {
      console.error('[ERROR] Ошибка при размещении ставки:', error);
      if (callback) callback({ success: false, error: 'Ошибка при размещении ставки' });
    }
  });

  // Вывод средств
  socket.on('cash_out', (data, callback) => {
    try {
      const playerId = socket.id;
      const player = gameState.players[playerId];
      
      if (!player) {
        if (callback) callback({ success: false, error: 'Игрок не найден' });
        return;
      }
      
      if (!gameState.isActive) {
        if (callback) callback({ success: false, error: 'Игра еще не началась' });
        return;
      }
      
      if (!player.inGame || player.didCashOut) {
        if (callback) callback({ success: false, error: 'Вы не участвуете в текущей игре' });
        return;
      }
      
      // Выполняем вывод средств
      player.didCashOut = true;
      player.cashOutMultiplier = gameState.currentMultiplier;
      player.inGame = false;
      
      // Рассчитываем выигрыш
      const winnings = Math.floor(player.bet * player.cashOutMultiplier);
      player.balance += winnings;
      
      console.log(`[CASHOUT] Игрок ${player.username} вывел при ${player.cashOutMultiplier.toFixed(2)}x и выиграл ${winnings}`);
      
      // Отвечаем клиенту
      if (callback) {
        callback({
          success: true,
          multiplier: player.cashOutMultiplier,
          winnings: winnings,
          balance: player.balance
        });
      }
      
      // Оповещаем всех о выводе средств
      io.emit('player_cashed_out', {
        id: playerId,
        username: player.username,
        multiplier: player.cashOutMultiplier,
        winnings: winnings
      });
    } catch (error) {
      console.error('[ERROR] Ошибка при выводе средств:', error);
      if (callback) callback({ success: false, error: 'Ошибка при выводе средств' });
    }
  });

  // Установка авто-вывода
  socket.on('set_auto_cashout', (data) => {
    const playerId = socket.id;
    const player = gameState.players[playerId];
    
    if (player) {
      player.autoCashout = parseFloat(data.multiplier);
      console.log(`[AUTO] Игрок ${player.username} установил авто-вывод на ${player.autoCashout}x`);
    }
  });

  // Сообщение в чате
  socket.on('chat_message', (data) => {
    const playerId = socket.id;
    const player = gameState.players[playerId];
    
    if (player) {
      console.log(`[CHAT] ${player.username}: ${data.message}`);
      
      // Отправляем сообщение всем игрокам
      io.emit('chat_message', {
        username: player.username,
        message: data.message,
        timestamp: Date.now()
      });
    }
  });

  // Отключение
  socket.on('disconnect', () => {
    const playerId = socket.id;
    const player = gameState.players[playerId];
    
    if (player) {
      console.log(`[SOCKET] Игрок отключился: ${player.username}`);
      
      // Оповещаем всех об отключении
      io.emit('player_disconnected', {
        id: playerId,
        username: player.username
      });
      
      // Удаляем игрока
      delete gameState.players[playerId];
    } else {
      console.log(`[SOCKET] Соединение разорвано: ${playerId}`);
    }
  });
});

// Запуск обратного отсчета
function startCountdown() {
  console.log('[GAME] Начало обратного отсчета...');
  
  // Защита от множественного запуска
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
  }
  
  let countdown = 5;
  
  // Оповещаем о начале отсчета
  io.emit('countdown_start', { timeLeft: countdown });
  
  countdownInterval = setInterval(() => {
    countdown--;
    
    // Оповещаем об обновлении
    io.emit('countdown_update', { timeLeft: countdown });
    
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      startGame();
    }
  }, 1000);
}

// Запуск игры
function startGame() {
  console.log('[GAME] Игра началась!');
  
  gameState.isActive = true;
  gameState.currentMultiplier = 1.0;
  
  // Собираем активных игроков
  const activePlayers = Object.values(gameState.players).filter(p => p.inGame);
  
  // Оповещаем о начале игры
  io.emit('game_start', { activePlayers });
  
  // Защита от множественного запуска
  if (gameInterval !== null) {
    clearInterval(gameInterval);
  }
  
  // Запускаем игровой цикл
  gameInterval = setInterval(() => {
    // Увеличиваем множитель
    gameState.currentMultiplier += 0.01;
    
    // Оповещаем об обновлении множителя
    io.emit('multiplier_update', { 
      multiplier: parseFloat(gameState.currentMultiplier.toFixed(2)) 
    });
    
    // Проверяем авто-вывод для всех игроков
    Object.values(gameState.players).forEach(player => {
      if (player.inGame && !player.didCashOut && player.autoCashout && gameState.currentMultiplier >= player.autoCashout) {
        // Выполняем авто-вывод
        player.didCashOut = true;
        player.cashOutMultiplier = gameState.currentMultiplier;
        player.inGame = false;
        
        // Рассчитываем выигрыш
        const winnings = Math.floor(player.bet * player.cashOutMultiplier);
        player.balance += winnings;
        
        console.log(`[AUTO] Авто-вывод для ${player.username} при ${player.cashOutMultiplier.toFixed(2)}x`);
        
        // Оповещаем о выводе средств
        io.emit('player_cashed_out', {
          id: player.id,
          username: player.username,
          multiplier: player.cashOutMultiplier,
          winnings: winnings,
          auto: true
        });
        
        // Оповещаем самого игрока
        const socket = io.sockets.sockets.get(player.id);
        if (socket) {
          socket.emit('cash_out_confirmed', {
            multiplier: player.cashOutMultiplier,
            winnings: winnings,
            balance: player.balance,
            auto: true
          });
        }
      }
    });
    
    // Проверка на крах
    // Вероятность краха увеличивается с ростом множителя
    const crashProbability = Math.min((gameState.currentMultiplier - 1) / 50, 0.1);
    
    if (Math.random() < crashProbability || gameState.currentMultiplier > 10) {
      handleCrash(parseFloat(gameState.currentMultiplier.toFixed(2)));
    }
  }, 100);
}

// Обработка краха
function handleCrash(crashPoint) {
  console.log(`[GAME] Крах при ${crashPoint}x`);
  
  // Останавливаем игровой цикл
  clearInterval(gameInterval);
  gameInterval = null;
  
  gameState.isActive = false;
  
  // Добавляем результат в историю недавних игр
  gameState.recentGames.unshift(crashPoint);
  if (gameState.recentGames.length > 10) {
    gameState.recentGames.pop();
  }
  
  // Получаем всех игроков в текущей игре
  const playersInGame = Object.values(gameState.players).filter(p => p.bet > 0);
  
  // Создаем объект с результатами игры для истории
  const gameResult = {
    timestamp: Date.now(),
    crashPoint: crashPoint,
    players: playersInGame.map(p => ({
      id: p.id,
      username: p.username,
      bet: p.bet,
      didCashOut: p.didCashOut,
      cashOutMultiplier: p.didCashOut ? p.cashOutMultiplier : 0
    }))
  };
  
  // Добавляем в историю
  gameState.history.unshift(gameResult);
  if (gameState.history.length > 20) {
    gameState.history.pop();
  }
  
  // Сбрасываем ставки для всех игроков
  Object.values(gameState.players).forEach(player => {
    if (player.inGame && !player.didCashOut) {
      // Игрок проиграл
      player.inGame = false;
      player.didCashOut = false;
      player.cashOutMultiplier = 0;
      player.bet = 0;
    } else if (player.inGame && player.didCashOut) {
      // Игрок вывел средства
      player.inGame = false;
      player.bet = 0;
    }
  });
  
  // Оповещаем о крахе
  io.emit('game_crash', {
    crashPoint,
    gameResult
  });
  
  // Начинаем новый раунд через 3 секунды
  setTimeout(() => {
    startCountdown();
  }, 3000);
}

// Определяем порт
const PORT = process.env.PORT || 8000;

// Запускаем сервер
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[SERVER] Сервер запущен на порту ${PORT}`);
  console.log(`[SERVER] Откройте в браузере: http://localhost:${PORT}`);
});

// Обработка выхода из процесса
process.on('SIGINT', () => {
  console.log('[SERVER] Завершение работы сервера...');
  process.exit(0);
}); 