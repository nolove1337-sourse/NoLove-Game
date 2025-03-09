import React, { useState, useEffect, useRef } from 'react';

const App: React.FC = () => {
  const [multiplier, setMultiplier] = useState<number>(1.00);
  const [betAmount, setBetAmount] = useState<string>('100');
  const [isFlying, setIsFlying] = useState<boolean>(false);
  const [gameOver, setGameOver] = useState<boolean>(false);
  const animationRef = useRef<number>(0);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 50, y: 50 });

  const startGame = () => {
    if (isFlying) return;
    setIsFlying(true);
    setGameOver(false);
    setPosition({ x: 50, y: 50 });
    setMultiplier(1.00);
    animate();
  };

  const animate = () => {
    setMultiplier(prev => {
      const increase = Math.random() * 0.1 + 0.01;
      return Number((prev + increase).toFixed(2));
    });

    setPosition(prev => ({
      x: prev.x + 1,
      y: prev.y - 1
    }));

    const random = Math.random();
    if (random < 0.02) { // 2% шанс проигрыша на каждом кадре
      setGameOver(true);
      setIsFlying(false);
      return;
    }

    animationRef.current = requestAnimationFrame(animate);
  };

  const cashOut = () => {
    if (!isFlying || gameOver) return;
    setIsFlying(false);
    cancelAnimationFrame(animationRef.current);
    // Здесь можно добавить логику начисления выигрыша
  };

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-primary text-text-primary">
      <header className="bg-secondary py-4">
        <div className="container mx-auto px-4">
          <h1 className="text-3xl font-bold">NoLove</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="bg-secondary rounded-lg p-6 max-w-md mx-auto">
          <div className="relative h-64 bg-primary rounded-lg mb-8">
            {!gameOver && (
              <div 
                className="absolute transition-transform duration-100"
                style={{
                  transform: `translate(${position.x}px, ${position.y}px)`,
                  color: isFlying ? '#4CAF50' : '#ffffff'
                }}
              >
                ✈️
              </div>
            )}
            {gameOver && (
              <div className="absolute inset-0 flex items-center justify-center text-red-500 text-4xl font-bold">
                CRASH!
              </div>
            )}
          </div>

          <div className="text-center mb-8">
            <div className="text-6xl font-bold mb-2" style={{ color: gameOver ? '#ff4444' : '#ffffff' }}>
              {multiplier.toFixed(2)}x
            </div>
            <div className="text-text-secondary">Текущий множитель</div>
          </div>

          <div className="space-y-4">
            <div className="bg-accent rounded-lg p-4">
              <label className="block text-text-secondary mb-2">Ставка</label>
              <input
                type="number"
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                className="w-full bg-primary px-4 py-2 rounded text-text-primary"
                min="1"
                disabled={isFlying}
              />
            </div>

            {!isFlying ? (
              <button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold disabled:opacity-50"
                onClick={startGame}
                disabled={gameOver && isFlying}
              >
                ИГРАТЬ
              </button>
            ) : (
              <button
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-bold"
                onClick={cashOut}
              >
                ЗАБРАТЬ {(Number(betAmount) * multiplier).toFixed(2)}
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App; 