'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import confetti from 'canvas-confetti';

type Question = {
  criminal: any;
  options: string[];
  correctCrime: string;
  questionNumber: number;
  selectedAnswer?: string | null; // what the user chose
};

export default function Home() {
  const [criminals, setCriminals] = useState<any[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = game not started, >=0 = viewing this question
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [mode, setMode] = useState<'10' | 'endless'>('10');
  const [nickname, setNickname] = useState('Névtelen Játékos');
  const [usedCriminalIds, setUsedCriminalIds] = useState<Set<string>>(new Set());
  const [usedCrimes, setUsedCrimes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCriminals();
  }, []);

  const fetchCriminals = async () => {
    const { data, error } = await supabase
      .from('criminals_cache')
      .select('*')
      .order('fetched_at', { ascending: false });

    if (error) {
      console.error('Hiba az adatok betöltésekor:', error);
    } else {
      setCriminals(data || []);
      console.log('Betöltött körözöttek száma:', data?.length);
    }
  };

  const startGame = () => {
    setQuestions([]);
    setCurrentIndex(-1);
    setScore(0);
    setStreak(0);
    setGameOver(false);
    setUsedCriminalIds(new Set());
    setUsedCrimes(new Set());
    loadNextQuestion();
  };

  const loadNextQuestion = () => {
    if (mode === '10' && questions.length >= 10) {
      setGameOver(true);
      saveScore();
      return;
    }

    if (criminals.length < 4) {
      console.warn('Nincs elég adat');
      return;
    }

    let available = criminals.filter(c => !usedCriminalIds.has(c.id));

    if (available.length === 0) {
      setUsedCriminalIds(new Set());
      setUsedCrimes(new Set());
      available = criminals;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    const correct = available[randomIndex];

    setUsedCriminalIds(prev => new Set([...prev, correct.id]));
    setUsedCrimes(prev => new Set([...prev, correct.crime]));

    let wrongPool = criminals.filter(c => 
      c.id !== correct.id && 
      c.crime !== correct.crime && 
      !usedCrimes.has(c.crime)
    );

    if (wrongPool.length < 3) {
      wrongPool = criminals.filter(c => 
        c.id !== correct.id && c.crime !== correct.crime
      );
    }

    const wrongCrimes = wrongPool
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(c => c.crime);

    while (wrongCrimes.length < 3) {
      wrongCrimes.push(wrongCrimes[wrongCrimes.length - 1] || 'Ismeretlen');
    }

    const allOptions = [correct.crime, ...wrongCrimes].sort(() => 0.5 - Math.random());

    const newQuestion: Question = {
      criminal: correct,
      options: allOptions,
      correctCrime: correct.crime,
      questionNumber: questions.length + 1,
      selectedAnswer: null,
    };

    setQuestions(prev => [...prev, newQuestion]);
    setCurrentIndex(questions.length); // go to new question
  };

  const handleAnswer = (answer: string) => {
    // Only answer on current/latest question
    if (currentIndex !== questions.length - 1) return;

    setQuestions(prev => {
      const updated = [...prev];
      updated[currentIndex] = { ...updated[currentIndex], selectedAnswer: answer };
      return updated;
    });

    const current = questions[currentIndex];
    const isCorrect = answer === current.correctCrime;

    if (isCorrect) {
      setScore(prev => prev + 10);
      setStreak(prev => prev + 1);
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
      });
    } else {
      setStreak(0);
    }

    setTimeout(() => {
      if (mode === '10' && questions.length >= 10) {
        setGameOver(true);
        saveScore();
      } else {
        loadNextQuestion();
      }
    }, 1800);
  };

  const goBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const goForward = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const saveScore = async () => {
    if (score > 0) {
      const { error } = await supabase.from('high_scores').insert({
        nickname,
        score,
      });
      if (error) console.error('Mentési hiba:', error);
    }
  };

  const current = questions[currentIndex];
  const isLatest = currentIndex === questions.length - 1;

  return (
// Remove or comment this entire return JSX block
// return (
//   <div className="min-h-screen bg-[#001f3f] text-white flex flex-col">
//     ...
//   </div>
// );

// Replace with proper API response, e.g.:
return Response.json({ message: "Scraping endpoint" });
      <div className="bg-red-800 p-4 text-center font-bold text-sm md:text-base">
        Ez kizárólag szórakoztató és oktatási célú kvíz. Minden adat hotlinkelve a Rendőrség nyilvános körözési listájáról (police.hu).  
        NEM hivatalos oldal, NEM használható valós feljelentésre vagy cselekvésre!
      </div>

      <header className="p-6 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-red-500">BTKkviz</h1>
        <p className="text-xl mt-2">Találd ki a bűntényt ránézésre! – Napi friss körözési lista alapján</p>
      </header>

      <main className="flex-grow p-4 md:p-6">
        {!gameOver ? (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-6">
              <p className="text-2xl md:text-3xl">
                Pontjaid: <span className="text-yellow-400 font-bold">{score} pont</span>
              </p>
              <p className="text-lg md:text-xl mt-1">
                Streak: {streak} | Kérdés {current ? current.questionNumber : 0}/{mode === '10' ? '10' : '∞'}
              </p>
            </div>

            {/* Navigation buttons - only show when there are answered questions */}
            {questions.length > 0 && (
              <div className="flex justify-center gap-6 mb-6">
                <button
                  onClick={goBack}
                  disabled={currentIndex <= 0}
                  className={`px-8 py-4 rounded-xl font-bold text-lg transition
                    ${currentIndex <= 0 
                      ? 'bg-gray-700 opacity-50 cursor-not-allowed' 
                      : 'bg-gray-600 hover:bg-gray-500'}`}
                >
                  ← Vissza
                </button>

                <button
                  onClick={goForward}
                  disabled={isLatest}
                  className={`px-8 py-4 rounded-xl font-bold text-lg transition
                    ${isLatest 
                      ? 'bg-gray-700 opacity-50 cursor-not-allowed' 
                      : 'bg-gray-600 hover:bg-gray-500'}`}
                >
                  Előre →
                </button>
              </div>
            )}

            {current ? (
              <div className="bg-gray-800 p-6 md:p-8 rounded-xl shadow-xl relative">
                <div className="text-center mb-8">
                  {current.criminal.photo_url ? (
                    <img
                      src={current.criminal.photo_url}
                      alt={current.criminal.name}
                      className="w-64 h-80 object-cover mx-auto rounded-xl border-4 border-red-600 shadow-2xl"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : null}

                  {!current.criminal.photo_url && (
                    <div className="w-64 h-80 bg-gray-700 mx-auto rounded-xl flex items-center justify-center text-gray-400 text-lg">
                      Nincs fotó
                    </div>
                  )}

                  <h2 className="text-3xl font-bold mt-6 text-yellow-300">
                    {current.criminal.name || 'Ismeretlen'}
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {current.options.map((opt, idx) => {
                    const isSelected = current.selectedAnswer === opt;
                    const isCorrect = opt === current.correctCrime;

                    return (
                      <div
                        key={idx}
                        className={`p-5 rounded-xl text-lg font-medium shadow-lg transition-all duration-300
                          ${isSelected
                            ? isCorrect
                              ? 'bg-green-600 text-white ring-4 ring-green-400'
                              : 'bg-red-600 text-white ring-4 ring-red-400'
                            : 'bg-blue-900'}`}
                      >
                        {opt}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="text-2xl text-yellow-300 mb-6">
                  {criminals.length === 0 ? 'Nincs adat – indítsd a scrapert!' : ''}
                </p>
              </div>
            )}

            <div className="mt-10 text-center">
              <select
                value={mode}
                onChange={e => setMode(e.target.value as '10' | 'endless')}
                className="bg-gray-800 p-4 rounded-xl text-white text-lg mr-6 mb-4 md:mb-0"
              >
                <option value="10">10 kérdés</option>
                <option value="endless">Végtelen mód</option>
              </select>

              <button
                onClick={startGame}
                className="bg-red-600 hover:bg-red-700 px-10 py-5 rounded-xl font-bold text-xl shadow-xl"
              >
                {questions.length === 0 ? 'Játék indítása' : 'Új játék'}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <h2 className="text-6xl font-bold text-yellow-400 mb-8">Gratulálunk!</h2>
            <p className="text-5xl mb-10">
              Összesen: <strong>{score} pont</strong>
            </p>

            <input
              type="text"
              placeholder="Beceneved"
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              className="p-5 bg-gray-800 rounded-xl w-96 text-center text-xl text-white"
            />

            <button
              onClick={startGame}
              className="mt-10 bg-green-600 hover:bg-green-700 px-16 py-6 rounded-xl text-3xl font-bold block mx-auto shadow-2xl"
            >
              Új játék
            </button>
          </div>
        )}
      </main>

      <footer className="bg-red-800 p-5 text-center text-base mt-auto">
        Hobbi kvíz szórakozásra és oktatásra. Adatok hotlinkelve a Rendőrség nyilvános oldaláról (police.hu).  
        NEM áll kapcsolatban a hatóságokkal. Semmilyen valós cselekvésre NEM használható!  
        Kérdés esetén: kereslek.wanted@proton.me
      </footer>
    </div>
  );
}