'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import confetti from 'canvas-confetti';
import html2canvas from 'html2canvas';

type Question = {
  criminal: any;
  options: string[];
  correctCrime: string;
  questionNumber: number;
  selectedAnswer?: string | null;
};

type ChatMessage = {
  id: string;
  nickname: string;
  message: string;
  created_at: string;
};

type ScoreEntry = {
  id: string;
  nickname: string;
  score: number;
  streak: number;
  time_taken: number | null;
  created_at: string;
};

export default function Home() {
  const [criminals, setCriminals] = useState<any[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [mode, setMode] = useState<'10' | 'endless'>('10');
  const [nickname, setNickname] = useState('Névtelen Játékos');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [usedCriminalIds, setUsedCriminalIds] = useState<Set<string>>(new Set());
  const [usedCrimesGlobal, setUsedCrimesGlobal] = useState<Set<string>>(new Set());

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatNickname, setChatNickname] = useState('Névtelen');
  const [chatOpen, setChatOpen] = useState(true);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Share
  const resultShareRef = useRef<HTMLDivElement>(null);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);

  // NEW: Feedback state for showing correct answer green after wrong selection
  const [showFeedback, setShowFeedback] = useState(false);

  const current = questions[currentIndex];
  const isLatest = currentIndex === questions.length - 1;
  const timeTaken = endTime ? Math.round((endTime - startTime) / 1000) : null;
  const shareHint = current ? current.criminal.crime.split(' - ')[0] : 'Bűncselekmény';

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chatNickname');
      if (saved) setChatNickname(saved);
    }
    fetchCriminals();
  }, []);

  useEffect(() => {
    if (criminals.length >= 4 && currentIndex === -1) {
      startGame();
    }
  }, [criminals]);

useEffect(() => {
  const loadMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        // .order(...) etc.

      if (error) throw error;

      // set state with data
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  };

  loadMessages(); // fire-and-forget

  // Optional: return cleanup if you have subscriptions
  // return () => { supabase.removeAllSubscriptions(); };
}, []); // empty deps = run once on mount




    const channel = supabase
      .channel('chat_messages_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
        setChatMessages(prev => [...prev, payload.new as ChatMessage]);
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('chatNickname', chatNickname);
  }, [chatNickname]);

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !chatNickname.trim()) return;

    const optimisticMsg = {
      id: crypto.randomUUID(),
      nickname: chatNickname.trim(),
      message: chatInput.trim().slice(0, 200),
      created_at: new Date().toISOString(),
    };

    setChatMessages(prev => [...prev, optimisticMsg]);
    setChatInput('');

    const { error } = await supabase.from('chat_messages').insert({
      nickname: chatNickname.trim(),
      message: chatInput.trim().slice(0, 200),
    });

    if (error) {
      setChatError('Küldési hiba: ' + error.message);
      setChatMessages(prev => prev.filter(m => m.id !== optimisticMsg.id));
    }
  };

  const fetchCriminals = async () => {
    const { data, error } = await supabase
      .from('criminals_cache')
      .select('*')
      .order('fetched_at', { ascending: false });

    if (error) console.error('Hiba az adatok betöltésekor:', error);
    else {
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
    setSaveStatus('idle');
    setStartTime(Date.now());
    setEndTime(null);
    setUsedCriminalIds(new Set());
    setUsedCrimesGlobal(new Set());
    loadNextQuestion();
  };

  const loadNextQuestion = () => {
    setShowFeedback(false); // Reset feedback on new question
    if (mode === '10' && questions.length >= 10) {
      setEndTime(Date.now());
      setGameOver(true);
      fetchLeaderboard();
      return;
    }

    if (criminals.length < 4) return;

    let available = criminals.filter(c => c.photo_url && c.photo_url.trim() !== '' && !usedCriminalIds.has(c.id));

    if (available.length === 0) {
      setUsedCriminalIds(new Set());
      setUsedCrimesGlobal(new Set());
      available = criminals.filter(c => c.photo_url && c.photo_url.trim() !== '');
      if (available.length < 4) return;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    const correct = available[randomIndex];

    setUsedCriminalIds(prev => new Set([...prev, correct.id]));
    setUsedCrimesGlobal(prev => new Set([...prev, correct.crime]));

    const wrongSet = new Set<string>();
    const wrongPool = criminals.filter(c => 
      c.id !== correct.id && 
      c.crime !== correct.crime && 
      c.photo_url && c.photo_url.trim() !== ''
    );

    wrongPool.sort(() => 0.5 - Math.random());
    for (const c of wrongPool) {
      if (wrongSet.size < 3) wrongSet.add(c.crime);
    }

    let wrongCrimes = Array.from(wrongSet);

    while (wrongCrimes.length < 3) {
      wrongCrimes.push(wrongCrimes[wrongCrimes.length - 1] || 'Ismeretlen bűncselekmény');
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
    setCurrentIndex(questions.length);
  };

  const handleAnswer = (answer: string) => {
    if (currentIndex !== questions.length - 1) return;

    const isCorrect = answer === questions[currentIndex].correctCrime;

    setQuestions(prev => {
      const updated = [...prev];
      updated[currentIndex] = { ...updated[currentIndex], selectedAnswer: answer };
      return updated;
    });

    if (isCorrect) {
      setScore(prev => prev + 10);
      setStreak(prev => prev + 1);
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      setShowFeedback(false);
    } else {
      setStreak(0);
      setShowFeedback(true); // Show correct answer green for 3 seconds
    }

    setTimeout(() => {
      setShowFeedback(false); // Hide feedback after 3 seconds
      if (mode === '10' && questions.length >= 10) {
        setEndTime(Date.now());
        setGameOver(true);
        fetchLeaderboard();
      } else {
        loadNextQuestion();
      }
    }, 3000); // ← Changed to 3000 ms (3 seconds)
  };
  

  const goBack = () => {
    if (currentIndex > 0) setCurrentIndex(prev => prev - 1);
  };

  const goForward = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex(prev => prev + 1);
  };

  const saveScore = async () => {
    if (score === 0 || nickname.trim() === '') return;

    setSaveStatus('saving');

    const timeTaken = Math.round((Date.now() - startTime) / 1000);

    const payload = {
      nickname: nickname.trim(),
      score,
      streak,
      time_taken: timeTaken,
    };

    console.log('Mentési payload:', payload);

    const { error } = await supabase.from('high_scores').insert(payload);

    if (error) {
      console.error('Mentési hiba részletesen:', error);
      setSaveStatus('error');
    } else {
      console.log('Sikeres mentés');
      setSaveStatus('success');
      fetchLeaderboard();
    }
  };

  const handleNicknameKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') saveScore();
  };

  const fetchLeaderboard = async () => {
    const { data, error } = await supabase
      .from('high_scores')
      .select('id, nickname, score, streak, time_taken, created_at')
      .order('score', { ascending: false })
      .limit(10);

    if (!error && data) {
      setLeaderboard(data);
    } else {
      console.error('Leaderboard fetch error:', error);
    }
  };

  const generateQuestionShare = async () => {
    if (!current) {
      alert('Nincs betöltve kérdés a megosztáshoz!');
      return;
    }

    const criminalName = current.criminal.name || 'Ez a személy';
    const hintText = shareHint || 'ismeretlen bűncselekmény';

    const shareText = `Tudod kitalálni, mit követett el ${criminalName}? Gyanús bűncselekmény: ${hintText}. Gyere játszani és teszteld magad a BTK kvízben!`;

    try {
      console.log('Generating criminal-specific share...');

      if (navigator.share) {
        await navigator.share({
          title: 'BTK kvíz kihívás!',
          text: shareText,
          url: `${window.location.origin}?c=${current.criminal.id}`,
        });
        console.log('Native share success');
      } else {
        const fallbackText = `${shareText}\n\nJátssz most ezen a kérdésen: ${window.location.origin}?c=${current.criminal.id}`;
        navigator.clipboard.writeText(fallbackText);
        alert('Natív megosztás nem támogatott – a kihívás szövege és link kimásolva a vágólapra!');
        console.log('Fallback: text + link copied');
      }
    } catch (err) {
      console.error('Megosztási hiba:', err);
      alert('Megosztás nem sikerült – próbáld a link másolását!');
    }
  };

  const generateResultShare = async () => {
    if (!resultShareRef.current) {
      alert('Nincs eredmény a megosztáshoz – próbáld újra!');
      return;
    }

    try {
      console.log('Generating result share...');
      const canvas = await html2canvas(resultShareRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#001f3f',
        logging: true,
      });

      const imageUrl = canvas.toDataURL('image/png');
      setShareImageUrl(imageUrl);

      const link = document.createElement('a');
      link.download = 'btk-kviz-eredmeny.png';
      link.href = imageUrl;
      link.click();

      if (navigator.share && navigator.canShare) {
        const blob = await (await fetch(imageUrl)).blob();
        const file = new File([blob], 'btk-kviz-eredmeny.png', { type: 'image/png' });
        await navigator.share({
          files: [file],
          title: 'BTK kvíz eredményem!',
          text: `Én ${score} pontot értem el (Streak: ${streak}, Idő: ${timeTaken ? timeTaken + ' mp' : '?'})! Te tudod-e verni?`,
        });
      }
    } catch (err) {
      console.error('Eredmény kép hiba:', err);
      alert('Eredmény kép generálása sikertelen – próbáld újra!');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#001f3f] to-[#0a2540] text-white flex flex-col relative font-sans">
      {/* Chat Sidebar */}
      <div className={`fixed top-0 right-0 h-full w-96 bg-gray-950 border-l border-gray-800 shadow-2xl transform transition-transform duration-300 z-50 ${chatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-900">
          <h3 className="text-xl font-extrabold text-blue-400">Élő chat</h3>
          <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white text-2xl font-bold">
            ×
          </button>
        </div>

        <div className="p-5 flex flex-col h-[calc(100%-10rem)] overflow-y-auto space-y-4 bg-gray-950 pb-32">
          {chatError && <p className="text-red-400 text-center font-medium">{chatError}</p>}

          {chatMessages.length === 0 && !chatError && (
            <p className="text-gray-500 text-center italic">Még nincsenek üzenetek...</p>
          )}

          {chatMessages.map((msg) => (
            <div key={msg.id} className={`p-4 rounded-2xl max-w-[85%] shadow-md ${msg.nickname === 'Admin' ? 'bg-blue-900/50 border border-blue-500/30 self-start' : 'bg-indigo-900/50 border border-indigo-500/30 self-end'}`}>
              <div className="flex justify-between text-xs text-gray-400 mb-2">
                <span className="font-bold">{msg.nickname}</span>
                <span>{new Date(msg.created_at).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <p className="break-words leading-relaxed text-base">{msg.message}</p>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="p-5 border-t border-gray-800 absolute bottom-0 left-0 right-0 bg-gray-950">
          <input
            type="text"
            placeholder="Beceneved (Enter mentés)"
            value={chatNickname}
            onChange={(e) => setChatNickname(e.target.value.slice(0, 30))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (typeof window !== 'undefined') localStorage.setItem('chatNickname', chatNickname);
                e.currentTarget.blur();
              }
            }}
            className="w-full p-3 mb-4 bg-gray-900 rounded-xl text-white border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 shadow-inner"
          />
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="Üzenet..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()}
              className="flex-grow p-3 bg-gray-900 rounded-xl text-white border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/50 shadow-inner"
            />
            <button
              onClick={sendChatMessage}
              disabled={!chatInput.trim() || !chatNickname.trim()}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 rounded-xl font-bold text-white hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              Küld
            </button>
          </div>
        </div>
      </div>

      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          className="fixed top-4 right-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-full shadow-2xl z-50 md:hidden flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          Chat
        </button>
      )}

      <div className="bg-gradient-to-r from-red-900 to-red-800 p-4 text-center font-bold text-base shadow-lg">
        Ez kizárólag szórakoztató és oktatási célű kvíz. Minden adat hotlinkelve a Rendőrség nyilvános körözési listájáról (police.hu).  
        NEM hivatalos oldal, NEM használható valós feljelentésre vagy cselekvésre!
      </div>

      <header className="p-8 text-center bg-gradient-to-b from-[#001f3f] to-transparent">
        <h1 className="text-6xl md:text-8xl font-extrabold text-red-500 tracking-tight drop-shadow-lg">BTK kvíz</h1>
        <p className="text-2xl mt-4 text-gray-300 font-medium">Találd ki a bűntényt ránézésre! 🔥 Napi friss rendőrségi körözési lista alapján</p>
      </header>

      <main className="flex-grow p-6 md:p-10">
        {!gameOver ? (
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <p className="text-4xl font-extrabold text-yellow-400 drop-shadow-md">
                Pontjaid: {score} pont
              </p>
              <p className="text-2xl mt-3 text-gray-300">
                Streak: <span className="text-orange-400 font-bold">{streak} 🔥</span> | Kérdés {current ? current.questionNumber : 0}/{mode === '10' ? '10' : '∞'}
              </p>
            </div>

            {questions.length > 0 && (
              <div className="flex justify-center gap-8 mb-10">
                <button onClick={goBack} disabled={currentIndex <= 0} className={`px-10 py-5 rounded-2xl font-bold text-xl transition-all ${currentIndex <= 0 ? 'bg-gray-800 opacity-50 cursor-not-allowed' : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 shadow-lg active:scale-95'}`}>
                  ← Vissza
                </button>
                <button onClick={goForward} disabled={isLatest} className={`px-10 py-5 rounded-2xl font-bold text-xl transition-all ${isLatest ? 'bg-gray-800 opacity-50 cursor-not-allowed' : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 shadow-lg active:scale-95'}`}>
                  Előre →
                </button>
              </div>
            )}

            {current ? (
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-8 md:p-12 rounded-3xl shadow-2xl border border-gray-700 relative">
                <div className="text-center mb-10">
                  {current.criminal.photo_url ? (
                    <img
                      src={current.criminal.photo_url}
                      alt={current.criminal.name}
                      className="w-72 h-96 object-cover mx-auto rounded-3xl border-4 border-white/80 shadow-2xl transform hover:scale-105 transition-transform duration-300"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-72 h-96 bg-gray-800 mx-auto rounded-3xl flex items-center justify-center text-gray-400 text-3xl border-4 border-white/80 shadow-2xl">
                      Nincs fotó
                    </div>
                  )}
                  <h2 className="text-5xl font-extrabold mt-8 text-yellow-400 drop-shadow-lg">{current.criminal.name || 'Ismeretlen'}</h2>

                  <button
                    onClick={generateQuestionShare}
                    className="absolute top-6 right-6 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white p-4 rounded-full shadow-xl transform hover:scale-110 transition-all duration-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {current.options.map((opt, idx) => {
                    const isSelected = current.selectedAnswer === opt;
                    const isCorrect = opt === current.correctCrime;
                    const isWrong = current.selectedAnswer && isSelected && !isCorrect;

                    let buttonClass = 'p-6 rounded-2xl text-xl font-bold transition-all duration-300 shadow-lg border-2 border-transparent';

                    if (isSelected) {
                      buttonClass += isCorrect ? ' bg-green-600 text-white border-green-400 ring-4 ring-green-300/50' : ' bg-red-600 text-white border-red-400 ring-4 ring-red-300/50';
                    } else if (showFeedback && isCorrect) {
                      buttonClass += ' bg-green-600 text-white border-green-400 ring-4 ring-green-300/50 animate-pulse';
                    } else if (isLatest) {
                      buttonClass += ' bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white border-indigo-500/50 hover:border-indigo-400';
                    } else {
                      buttonClass += ' bg-gray-800 opacity-70 cursor-not-allowed border-gray-700';
                    }

                    return (
                      <button
                        key={idx}
                        onClick={() => isLatest ? handleAnswer(opt) : undefined}
                        disabled={!isLatest}
                        className={buttonClass}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="text-4xl text-yellow-300 font-bold">
                  {criminals.length === 0 ? 'Nincs adat – indítsd a scrapert!' : 'Betöltés... 🔥'}
                </p>
              </div>
            )}

            <div className="mt-12 text-center">
              <select value={mode} onChange={e => setMode(e.target.value as '10' | 'endless')} className="bg-gray-900 p-5 rounded-2xl text-white text-xl mr-8 mb-6 md:mb-0 border-2 border-gray-700 focus:outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-400/50 shadow-lg">
                <option value="10">10 kérdés</option>
                <option value="endless">Végtelen</option>
              </select>

              <button onClick={startGame} className="bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 hover:from-red-700 hover:via-orange-600 hover:to-yellow-600 px-12 py-6 rounded-3xl font-extrabold text-3xl shadow-2xl transform hover:scale-105 transition-all duration-300">
                ÚJ JÁTÉK
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-24">
            <h2 className="text-7xl font-extrabold text-yellow-400 mb-10 flex justify-center items-center gap-6 drop-shadow-2xl">
              <span className="text-8xl animate-bounce">🏆</span> Kiváló Eredmény!
            </h2>
            <p className="text-6xl mb-8 font-bold text-white drop-shadow-lg">
              Összesen: <span className="text-green-400">{score} pont</span>
            </p>
            <p className="text-4xl mb-12 flex justify-center items-center gap-4">
              Streak: <span className="text-orange-400 font-extrabold">{streak}</span> <span className="text-6xl animate-pulse">🔥</span> | Idő: <span className="text-blue-300">{timeTaken ? `${timeTaken} másodperc` : '—'}</span>
            </p>

            <div className="flex flex-col items-center gap-8 max-w-lg mx-auto bg-gray-900/80 p-10 rounded-3xl border border-yellow-500/30 shadow-2xl backdrop-blur-sm">
              <input
                type="text"
                placeholder="Beceneved"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && saveScore()}
                className="p-6 bg-gray-800 rounded-2xl w-full text-center text-2xl text-white border-2 border-gray-700 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/30 shadow-inner"
                disabled={saveStatus === 'saving'}
              />

              <button
                onClick={saveScore}
                disabled={saveStatus === 'saving' || score === 0 || nickname.trim() === ''}
                className={`w-full px-16 py-6 rounded-3xl text-3xl font-extrabold shadow-2xl transition-all duration-300 transform hover:scale-105 ${saveStatus === 'saving' ? 'bg-gray-700 cursor-wait' : saveStatus === 'success' ? 'bg-green-600' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'}`}
              >
                {saveStatus === 'saving' ? 'Mentés...' : saveStatus === 'success' ? 'Mentve ✓' : 'Mentés a ranglistára'}
              </button>

              {saveStatus === 'success' && (
                <p className="text-green-400 text-2xl mt-4 font-bold animate-pulse">
                  Pontjaid mentve! 🏆
                </p>
              )}

              {saveStatus === 'error' && (
                <p className="text-red-400 text-2xl mt-4 font-bold">
                  Hiba a mentés során – próbáld újra!
                </p>
              )}

              {/* Result Share Options */}
              <div className="flex flex-wrap justify-center gap-6 mt-12">
                <button
                  onClick={generateResultShare}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 px-10 py-5 rounded-3xl font-bold text-xl shadow-xl transform hover:scale-105 transition-all"
                >
                  Kép letöltése
                </button>

                <button
                  onClick={async () => {
                    if (navigator.share) {
                      try {
                        await navigator.share({
                          title: 'BTK kvíz eredményem!',
                          text: `Én ${score} pontot értem el (Streak: ${streak} 🔥, Idő: ${timeTaken ? timeTaken + ' mp' : '?'})! Te tudod-e verni? Játssz most!`,
                          url: window.location.origin,
                        });
                      } catch (err) {
                        console.log('Web Share failed:', err);
                        alert('Megosztás nem sikerült – másold a linket!');
                      }
                    } else {
                      alert('A böngésződ nem támogatja a natív megosztást – használd a link másolást!');
                    }
                  }}
                  className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 px-10 py-5 rounded-3xl font-bold text-xl shadow-xl transform hover:scale-105 transition-all"
                >
                  Natív megosztás
                </button>

                <button
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin);
                    alert('Játék link másolva a vágólapra!');
                  }}
                  className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 px-10 py-5 rounded-3xl font-bold text-xl shadow-xl transform hover:scale-105 transition-all"
                >
                  Link másolása
                </button>

                <a
                  href={`mailto:?subject=BTK kvíz kihívás&body=Én ${score} pontot értem el (Streak: ${streak} 🔥, Idő: ${timeTaken ? timeTaken + ' mp' : '?'})! Te tudod-e verni? Játssz most: ${window.location.origin}`}
                  className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 px-10 py-5 rounded-3xl font-bold text-xl shadow-xl transform hover:scale-105 transition-all text-center"
                >
                  Email
                </a>

                <a
                  href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=Én ${score} pontot értem el a BTK kvízben! Streak: ${streak} 🔥`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gradient-to-r from-blue-800 to-indigo-900 hover:from-blue-900 hover:to-indigo-950 px-10 py-5 rounded-3xl font-bold text-xl shadow-xl transform hover:scale-105 transition-all text-center"
                >
                  Facebook
                </a>
              </div>

              {/* Leaderboard */}
              <div className="w-full mt-16">
                <h3 className="text-5xl font-extrabold text-yellow-400 mb-10 flex justify-center items-center gap-5 drop-shadow-2xl">
                  <span className="text-6xl animate-bounce">🏆</span> Ranglista (Top 10)
                  {saveStatus === 'success' && <span className="text-green-400 text-3xl animate-pulse">Mentve ✓</span>}
                </h3>
                {leaderboard.length === 0 ? (
                  <p className="text-gray-400 text-3xl italic">Még nincsenek mentett pontok... Légy az első! 🔥</p>
                ) : (
                  <div className="space-y-6">
                    {leaderboard.map((entry, idx) => (
                      <div key={entry.id} className={`flex justify-between items-center p-6 rounded-3xl shadow-xl border ${idx === 0 ? 'bg-yellow-900/40 border-yellow-500/50' : idx === 1 ? 'bg-gray-300/20 border-gray-400/50' : idx === 2 ? 'bg-orange-900/30 border-orange-500/50' : 'bg-gray-900/80 border-gray-700'}`}>
                        <div className="flex items-center gap-6">
                          <span className={`text-5xl font-extrabold w-20 text-center drop-shadow-lg ${idx === 0 ? 'text-yellow-400' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-orange-400' : 'text-gray-400'}`}>
                            {idx + 1}.
                          </span>
                          <div>
                            <p className="text-3xl font-bold">{entry.nickname}</p>
                            <p className="text-xl text-gray-300 mt-1">
                              Streak: <span className="text-orange-400 font-bold">{entry.streak} 🔥</span> | Idő: <span className="text-blue-300">{entry.time_taken ? `${entry.time_taken} mp` : '?'}</span>
                            </p>
                          </div>
                        </div>
                        <span className="text-5xl font-extrabold text-green-400 drop-shadow-lg">{entry.score} pont</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={startGame} className="mt-16 bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 hover:from-green-700 hover:via-emerald-600 hover:to-teal-600 px-20 py-8 rounded-3xl text-4xl font-extrabold shadow-2xl transform hover:scale-105 transition-all duration-300">
                ÚJ JÁTÉK 🔥
              </button>
            </div>

            {/* Hidden result share card */}
            <div ref={resultShareRef} style={{ display: 'none' }}>
              <div className="w-[600px] bg-gradient-to-br from-[#001f3f] to-[#0a2540] text-white p-12 rounded-3xl border-4 border-yellow-500/50 shadow-2xl">
                <div className="text-center">
                  <h2 className="text-6xl font-extrabold text-yellow-400 mb-8 flex justify-center items-center gap-6 drop-shadow-2xl">
                    <span className="text-7xl animate-bounce">🏆</span> Kiváló Eredmény!
                  </h2>
                  <p className="text-5xl mb-8 font-bold">
                    Összesen: <span className="text-green-400">{score} pont</span>
                  </p>
                  <p className="text-4xl mb-12 flex justify-center items-center gap-4">
                    Streak: <span className="text-orange-400 font-extrabold">{streak}</span> <span className="text-6xl animate-pulse">🔥</span> | Idő: <span className="text-blue-300">{timeTaken ? `${timeTaken} másodperc` : '—'}</span>
                  </p>

                  <p className="text-3xl mt-12">Gyere te is játszani: <strong className="text-yellow-300">btkkviz.hu</strong></p>
                  <p className="text-xl text-gray-400 mt-4">Napi friss körözési lista alapján – kihívás mindenkinek! 🚀</p>
                </div>
              </div>
            </div>

            {shareImageUrl && (
              <div className="mt-12">
                <img src={shareImageUrl} alt="Share preview" className="max-w-full rounded-3xl shadow-2xl mx-auto border-4 border-white/30" />
                <p className="text-lg text-gray-400 mt-4 text-center">Kép generálva – letöltve vagy megosztható</p>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="bg-gradient-to-t from-red-950 to-red-900 p-8 text-center text-lg mt-auto shadow-inner">
        Hobbi kvíz szórakozásra és oktatásra. Adatok hotlinkelve a Rendőrség nyilvános oldaláról (police.hu).  
        NEM áll kapcsolatban a hatóságokkal. Semmilyen valós cselekvésre NEM használható!  
        Kérdés esetén: kereslek.wanted@proton.me
      </footer>
    </div>
  );
}