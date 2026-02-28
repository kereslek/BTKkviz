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
  const [nickname, setNickname] = useState('Névtelen Játékos');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [leaderboard, setLeaderboard] = useState<ScoreEntry[]>([]);
  const [startTime, setStartTime] = useState<number>(0);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [usedCriminalIds, setUsedCriminalIds] = useState<Set<string>>(new Set());
  const [usedCrimesGlobal, setUsedCrimesGlobal] = useState<Set<string>>(new Set());
  const [showFeedback, setShowFeedback] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatNickname, setChatNickname] = useState('Névtelen');
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const resultShareRef = useRef<HTMLDivElement>(null);
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [totalGamesPlayed, setTotalGamesPlayed] = useState(0);
  const [loading, setLoading] = useState(true);

  const current = questions[currentIndex];
  const isLatest = currentIndex === questions.length - 1;
  const timeTaken = endTime ? Math.round((endTime - startTime) / 1000) : null;
  const cleanCrime = (crime: string) => crime.split(' - ')[0].trim();
  const shareHint = current ? cleanCrime(current.criminal.crime) : 'Bűncselekmény';

  // Progress: only counts fully answered questions (fills to 100% AFTER Q10 answered)
  const answeredCount = questions.filter(q => q.selectedAnswer !== undefined).length;
  const progressPercentage = Math.min((answeredCount / 10) * 100, 100);

  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  useEffect(() => {
    const checkMobile = () => {
      if (window.innerWidth < 768) setChatOpen(false);
      else setChatOpen(true);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);



useEffect(() => {
  const channel = supabase.channel('online-players');

  channel
    .on('presence', { event: 'sync' }, () => {
      const presenceState = channel.presenceState();
      const count = Object.keys(presenceState).length;
      setOnlinePlayers(count);
    })
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ online: true, userId: generateUUID() });
      }
    });

  // Named cleanup function – this dodges the "Expression expected" parser crash
  return function cleanup() {
    channel.untrack();
    supabase.removeChannel(channel);
  };
}, []);



  // Return cleanup function
  return () => {
    channel.untrack();
    supabase.removeChannel(channel);
  };
}, []);

  useEffect(() => {
    const fetchTotal = async () => {
      const { count, error } = await supabase.from('high_scores').select('*', { count: 'exact', head: true });
      if (!error) setTotalGamesPlayed(count || 0);
    };
    fetchTotal();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chatNickname');
      if (saved) setChatNickname(saved);
    }
    fetchCriminals();
  }, []);

  const fetchCriminals = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('criminals_cache')
      .select('*')
      .not('police_id', 'is', null)
      .not('photo_url', 'is', null)
      .neq('name', 'Ismeretlen')
      .neq('name', 'Személyes adatok')
      .not('name', 'ilike', '%ELFOGATÓPARANCS%')
      .not('name', 'ilike', '%§%')
      .order('fetched_at', { ascending: false });

    if (error) {
      console.error('Error fetching criminals:', error);
    } else {
      const loadedCriminals = data || [];
      console.log('Loaded valid criminals:', loadedCriminals.length);
      setCriminals(loadedCriminals);
    }
    setLoading(false);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || !chatNickname.trim()) return;
    const optimisticMsg = {
      id: generateUUID(),
      nickname: chatNickname.trim(),
      message: chatInput.trim().slice(0, 200),
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, optimisticMsg]);
    setChatInput('');
    const { error } = await supabase.from('chat_messages').insert({
      nickname: chatNickname.trim(),
      message: chatInput.trim().slice(0, 200),
    });
    if (error) {
      setChatError('Küldési hiba: ' + error.message);
      setChatMessages((prev) => prev.filter((m) => m.id !== optimisticMsg.id));
    }
  };

  const runScraper = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/scrape');
      if (response.ok) {
        const result = await response.json();
        console.log('Scraper result:', result);
        await fetchCriminals();
      } else {
        console.error('Scraper failed:', response.status);
      }
    } catch (e) {
      console.error('Scraper error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (criminals.length >= 4 && currentIndex === -1 && !loading) {
      startGame();
    }
  }, [criminals, loading]);

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
    setShowFeedback(false);
    if (questions.length >= 10) {
      setEndTime(Date.now());
      setGameOver(true);
      fetchLeaderboard();
      return;
    }
    if (criminals.length < 4) return;

    let available = criminals.filter((c) => c.police_id && !usedCriminalIds.has(String(c.police_id)));
    console.log(`[game] Available pool size: ${available.length}`);

    if (available.length === 0) {
      console.log('[game] Resetting used IDs - full refresh');
      setUsedCriminalIds(new Set());
      setUsedCrimesGlobal(new Set());
      available = criminals.filter((c) => c.police_id);
      if (available.length < 4) return;
    }

    const randomIndex = Math.floor(Math.random() * available.length);
    const correct = available[randomIndex];
    console.log(`[game] Selected police_id: ${correct.police_id}, name: ${correct.name}`);

    setUsedCriminalIds((prev) => new Set([...prev, String(correct.police_id)]));
    setUsedCrimesGlobal((prev) => new Set([...prev, correct.crime]));

    const wrongSet = new Set<string>();
    const wrongPool = criminals.filter(
      (c) => String(c.police_id) !== String(correct.police_id) && c.crime !== correct.crime && c.police_id
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

    setQuestions((prev) => {
      const updated = [...prev, newQuestion];
      setCurrentIndex(updated.length - 1);
      return updated;
    });
  };

  const handleAnswer = (answer: string) => {
    if (currentIndex !== questions.length - 1) return;
    const isCorrect = answer === questions[currentIndex].correctCrime;
    setQuestions((prev) => {
      const updated = [...prev];
      updated[currentIndex] = { ...updated[currentIndex], selectedAnswer: answer };
      return updated;
    });
    if (isCorrect) {
      setScore((prev) => prev + 10);
      setStreak((prev) => prev + 1);
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      setShowFeedback(false);
    } else {
      setStreak(0);
      setShowFeedback(true);
    }
    setTimeout(() => {
      setShowFeedback(false);
      // After final answer → force 100% and end game
      if (questions.length >= 10) {
        setEndTime(Date.now());
        setGameOver(true);
        fetchLeaderboard();
      } else {
        loadNextQuestion();
      }
    }, 2000);
  };

  const goBack = () => {
    if (currentIndex > 0) setCurrentIndex((prev) => prev - 1);
  };

  const goForward = () => {
    if (currentIndex < questions.length - 1) setCurrentIndex((prev) => prev + 1);
  };

  const saveScore = async () => {
    if (score === 0 || nickname.trim() === '') return;
    setSaveStatus('saving');
    const timeTakenValue = Math.round((Date.now() - startTime) / 1000);
    const payload = {
      nickname: nickname.trim(),
      score,
      streak,
      time_taken: timeTakenValue,
    };
    const { error } = await supabase.from('high_scores').insert(payload);
    if (error) {
      console.error('Mentési hiba:', error);
      setSaveStatus('error');
    } else {
      setSaveStatus('success');
      fetchLeaderboard();
    }
  };

  const fetchLeaderboard = async () => {
    const { data, error } = await supabase
      .from('high_scores')
      .select('id, nickname, score, streak, time_taken, created_at')
      .order('score', { ascending: false })
      .limit(10);
    if (!error && data) setLeaderboard(data);
  };

  const generateQuestionShare = async () => {
    if (!current) return alert('Nincs betöltve kérdés!');
    const criminalName = current.criminal.name || 'Ez a személy';
    const hintText = shareHint;
    const shareText =
      'Tudod kitalálni, mit követett el ' +
      criminalName +
      '? Gyanús bűncselekmény: ' +
      hintText +
      '. Gyere játszani és teszteld magad a BTK kvízben!';
    try {
      const shareUrl = `${window.location.origin}?c=${current.criminal.id}`;
      if (navigator.share) {
        await navigator.share({
          title: 'BTK kvíz kihívás!',
          text: shareText,
          url: shareUrl,
        });
      } else {
        navigator.clipboard.writeText(shareUrl);
        alert('Link kimásolva a vágólapra!');
      }
    } catch (err) {
      alert('Megosztás nem sikerült.');
    }
  };

  const generateResultShare = async () => {
    if (!resultShareRef.current) return alert('Nincs eredmény!');
    try {
      const canvas = await html2canvas(resultShareRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#001f3f',
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
          text: `Én ${score} pontot értem el! Te tudod-e verni?`,
        });
      }
    } catch (err) {
      alert('Kép generálása sikertelen.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#001f3f] to-[#0a2540] text-white flex flex-col relative font-sans">
      {/* Chat Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-gray-950 border-l border-gray-800 shadow-2xl transform transition-transform duration-300 z-50 ${
          chatOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
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
            <div
              key={msg.id}
              className={`p-4 rounded-2xl max-w-[85%] shadow-md ${
                msg.nickname === 'Admin' ? 'bg-blue-900/50 border border-blue-500/30 self-start' : 'bg-indigo-900/50 border border-indigo-500/30 self-end'
              }`}
            >
              <div className="flex justify-between text-xs text-gray-400 mb-2">
                <span className="font-bold mr-4">{msg.nickname}&nbsp;&nbsp;&nbsp;&nbsp;</span>
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
          className="fixed top-4 right-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 rounded-full shadow-2xl z-50 flex items-center justify-center hover:scale-110 transition-transform duration-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      <div className="bg-red-800 p-4 text-center font-bold text-base shadow-lg">
        Ez kizárólag szórakoztató és oktatási célú kvíz.
      </div>

      <header className="p-8 text-center bg-gradient-to-b from-[#001f3f] to-transparent">
        <h1 className="text-6xl md:text-8xl font-extrabold text-red-500 tracking-tight drop-shadow-lg">BTK kvíz</h1>
        <p className="text-2xl mt-4 text-gray-300 font-medium">
          Találd ki a bűntényt ránézésre! 🔥 Napi friss rendőrségi körözési lista alapján 🕵️‍♂️
        </p>
      </header>

      <main className="flex-grow p-6 md:p-10">
        {loading ? (
          <div className="text-center py-16 md:py-20">
            <p className="text-3xl md:text-4xl text-yellow-300 font-bold">Betöltés... 🔥</p>
          </div>
        ) : criminals.length < 4 ? (
          <div className="text-center py-16 md:py-20">
            <p className="text-3xl md:text-4xl text-yellow-300 font-bold">
              Nincs elég érvényes adat – indítsd a scrapert!
            </p>
            <button
              onClick={runScraper}
              className="mt-8 bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 hover:from-red-700 hover:via-orange-600 hover:to-yellow-600 px-10 md:px-12 py-5 md:py-6 rounded-3xl font-extrabold text-2xl md:text-3xl shadow-2xl transform hover:scale-105 transition-all duration-300"
            >
              Indítsd a scrapert!
            </button>
          </div>
        ) : !gameOver ? (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-6 md:mb-8">
              <p className="text-3xl md:text-4xl font-extrabold text-yellow-400 drop-shadow-md">
                Pontjaid: {score} pont
              </p>
              <p className="text-lg md:text-xl mt-2 text-gray-300">
                Streak: <span className="text-orange-400 font-bold">{streak} 🔥</span> | Kérdés {current ? current.questionNumber : 0}/10
              </p>

              {/* Progress bar */}
              <div className="mt-4 w-full max-w-md mx-auto bg-gray-700 rounded-full h-4 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-green-500 via-emerald-400 to-teal-500 h-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
            </div>

            {current && current.criminal ? (
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 p-5 md:p-8 rounded-3xl shadow-2xl border border-gray-700 relative">
                <div className="text-center mb-6 md:mb-8">
                  {current.criminal.photo_url ? (
                    <a
                      href={`https://www.police.hu/hu/koral/elfogatoparancs-alapjan-korozott-szemelyek/${current.criminal.police_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block cursor-pointer"
                    >
                      <img
                        src={current.criminal.photo_url}
                        alt={current.criminal.name}
                        className="w-56 h-72 md:w-64 md:h-80 object-cover mx-auto rounded-3xl border-4 border-white/80 shadow-2xl transform hover:scale-105 transition-transform duration-300"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    </a>
                  ) : (
                    <div className="w-56 h-72 md:w-64 md:h-80 bg-gray-800 mx-auto rounded-3xl flex items-center justify-center text-gray-400 text-2xl border-4 border-white/80 shadow-2xl">
                      Nincs fotó
                    </div>
                  )}
                  <h2 className="text-3xl md:text-5xl font-extrabold mt-4 md:mt-6 text-yellow-400 drop-shadow-lg">
                    {current.criminal.name || 'Ismeretlen'}
                  </h2>
                  <button
                    onClick={generateQuestionShare}
                    className="absolute top-3 md:top-4 right-3 md:right-4 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white p-3 md:p-4 rounded-full shadow-xl transform hover:scale-110 transition-all duration-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-7 md:w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-5">
                  {current.options.map((opt, idx) => {
                    const isSelected = current.selectedAnswer === opt;
                    const isCorrect = opt === current.correctCrime;
                    let buttonClass = 'p-4 md:p-6 rounded-2xl text-base md:text-xl font-bold transition-all duration-300 shadow-lg border-2 border-transparent';
                    if (isSelected && !isCorrect) {
                      buttonClass += ' bg-red-600 text-white border-red-400 ring-4 ring-red-300/50';
                    } else if ((isSelected && isCorrect) || (showFeedback && isCorrect)) {
                      buttonClass += ' bg-green-600 text-white border-green-400 ring-4 ring-green-300/50';
                      if (showFeedback && isCorrect) buttonClass += ' animate-pulse';
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
                        {cleanCrime(opt)}
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-center gap-6 md:gap-8 mt-8 md:mt-10 mb-6">
                  <button onClick={goBack} disabled={currentIndex <= 0} className={`px-8 py-4 rounded-2xl font-bold text-lg md:text-xl transition-all ${currentIndex <= 0 ? 'bg-gray-800 opacity-50 cursor-not-allowed' : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 shadow-lg active:scale-95'}`}>
                    ← Vissza
                  </button>
                  <button onClick={goForward} disabled={isLatest} className={`px-8 py-4 rounded-2xl font-bold text-lg md:text-xl transition-all ${isLatest ? 'bg-gray-800 opacity-50 cursor-not-allowed' : 'bg-gradient-to-r from-gray-700 to-gray-800 hover:from-gray-600 hover:to-gray-700 shadow-lg active:scale-95'}`}>
                    Előre →
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 md:py-20">
                <p className="text-3xl md:text-4xl text-yellow-300 font-bold">Betöltés... 🔥</p>
              </div>
            )}

            <div className="mt-10 md:mt-12 text-center">
              <button
                onClick={startGame}
                className="bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 hover:from-red-700 hover:via-orange-600 hover:to-yellow-600 px-10 md:px-12 py-5 md:py-6 rounded-3xl font-extrabold text-2xl md:text-3xl shadow-2xl transform hover:scale-105 transition-all duration-300"
              >
                ÚJ JÁTÉK
              </button>
            </div>

            {shareImageUrl && (
              <div className="mt-10 md:mt-12">
                <img src={shareImageUrl} alt="Share preview" className="max-w-full rounded-3xl shadow-2xl mx-auto border-4 border-white/30" />
                <p className="text-base md:text-lg text-gray-400 mt-4 text-center">Kép generálva – letöltve vagy megosztható</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-20 md:py-24">
            <h2 className="text-6xl md:text-7xl font-extrabold text-yellow-400 mb-8 md:mb-10 flex justify-center items-center gap-4 md:gap-6 drop-shadow-2xl">
              <span className="text-7xl md:text-8xl animate-bounce">🏆</span> Kiváló Eredmény!
            </h2>
            <p className="text-5xl md:text-6xl mb-6 md:mb-8 font-bold text-white drop-shadow-lg">
              Összesen: <span className="text-green-400">{score} pont</span>
            </p>
            <p className="text-3xl md:text-4xl mb-10 md:mb-12 flex justify-center items-center gap-4">
              Streak: <span className="text-orange-400 font-extrabold">{streak}</span> <span className="text-6xl animate-pulse">🔥</span> | Idő: <span className="text-blue-300">{timeTaken ? `${timeTaken} másodperc` : '—'}</span>
            </p>

            <div className="flex flex-col items-center gap-6 md:gap-8 max-w-3xl mx-auto bg-gray-900/80 p-6 md:p-8 rounded-3xl border border-yellow-500/30 shadow-2xl backdrop-blur-sm">
              <input
                type="text"
                placeholder="Beceneved"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && saveScore()}
                className="p-5 md:p-6 bg-gray-800 rounded-2xl w-full text-center text-xl md:text-2xl text-white border-2 border-gray-700 focus:outline-none focus:border-yellow-400 focus:ring-4 focus:ring-yellow-400/30 shadow-inner"
                disabled={saveStatus === 'saving'}
              />
              <button
                onClick={saveScore}
                disabled={saveStatus === 'saving' || score === 0 || nickname.trim() === ''}
                className={`w-full px-12 md:px-16 py-5 md:py-6 rounded-3xl text-2xl md:text-3xl font-extrabold shadow-2xl transition-all duration-300 transform hover:scale-105 ${
                  saveStatus === 'saving' ? 'bg-gray-700 cursor-wait' : saveStatus === 'success' ? 'bg-green-600' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700'
                }`}
              >
                {saveStatus === 'saving' ? 'Mentés...' : saveStatus === 'success' ? 'Mentve ✓' : 'Mentés a ranglistára'}
              </button>
              {saveStatus === 'success' && (
                <p className="text-green-400 text-xl md:text-2xl mt-4 font-bold animate-pulse">Pontjaid mentve! 🏆</p>
              )}
              {saveStatus === 'error' && (
                <p className="text-red-400 text-xl md:text-2xl mt-4 font-bold">Hiba a mentés során – próbáld újra!</p>
              )}

              <div className="w-full mt-8 md:mt-12">
                <h3 className="text-4xl md:text-5xl font-extrabold text-yellow-400 mb-6 md:mb-8 text-center drop-shadow-2xl">
                  Ranglista (Top 10)
                </h3>

                {leaderboard.length === 0 ? (
                  <p className="text-gray-400 text-2xl md:text-3xl italic text-center">
                    Még nincsenek mentett pontok... Légy az első! 🔥
                  </p>
                ) : (
                  <div className="space-y-4 md:space-y-5">
                    {leaderboard.map((entry, idx) => (
                      <div
                        key={entry.id}
                        className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 p-5 md:p-6 rounded-3xl shadow-xl border backdrop-blur-sm ${
                          idx === 0
                            ? 'bg-yellow-900/40 border-yellow-500/60'
                            : idx === 1
                            ? 'bg-gray-300/20 border-gray-400/50'
                            : idx === 2
                            ? 'bg-orange-900/30 border-orange-500/50'
                            : 'bg-gray-900/80 border-gray-700'
                        }`}
                      >
                        <div className="flex items-center gap-4 md:gap-6 w-full sm:w-auto">
                          <span
                            className={`text-4xl md:text-5xl font-extrabold w-14 md:w-20 text-center drop-shadow-lg flex-shrink-0 ${
                              idx === 0
                                ? 'text-yellow-400'
                                : idx === 1
                                ? 'text-gray-300'
                                : idx === 2
                                ? 'text-orange-400'
                                : 'text-gray-400'
                            }`}
                          >
                            {idx + 1}.
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xl md:text-2xl font-bold truncate">{entry.nickname}</p>
                            <p className="text-sm md:text-base text-gray-300 mt-1">
                              Streak: <span className="text-orange-400 font-bold">{entry.streak} 🔥</span> | Idő:{' '}
                              <span className="text-blue-300">{entry.time_taken ? `${entry.time_taken} mp` : '?'}</span>
                            </p>
                          </div>
                        </div>

                        <span className="text-2xl md:text-4xl font-extrabold text-green-400 drop-shadow-lg whitespace-nowrap text-right w-full sm:w-auto">
                          {entry.score} pont
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={startGame}
                className="mt-12 md:mt-16 bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 hover:from-green-700 hover:via-emerald-600 hover:to-teal-600 px-16 md:px-20 py-6 md:py-8 rounded-3xl text-3xl md:text-4xl font-extrabold shadow-2xl transform hover:scale-105 transition-all duration-300"
              >
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
                    Streak: <span className="text-orange-400 font-extrabold">{streak}</span> <span className="text-6xl animate-pulse">🔥</span> | Idő:{' '}
                    <span className="text-blue-300">{timeTaken ? `${timeTaken} másodperc` : '—'}</span>
                  </p>
                  <p className="text-3xl mt-12">
                    Gyere te is játszani: <strong className="text-yellow-300">btkkviz.hu</strong>
                  </p>
                  <p className="text-xl text-gray-400 mt-4">
                    Napi friss körözési lista alapján – kihívás mindenkinek! 🚀
                  </p>
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

      <div className="text-center py-4 text-lg font-medium text-gray-300 space-y-2">
        <div>Jelenleg online: {onlinePlayers} játékos</div>
        <div>Összesen lejátszott játékok: {totalGamesPlayed}</div>
      </div>

      <footer className="bg-gradient-to-t from-red-950 to-red-900 p-6 md:p-8 text-center text-base md:text-lg mt-auto shadow-inner">
        Ez kizárólag szórakoztató és oktatási célú kvízjáték, emellett a hatóságok munkájának segítése és a közbiztonsági tudatosság növelése céljából is.
        Kérdés esetén: kereslek.wanted@proton.me
      </footer>
    </div>
  );
}