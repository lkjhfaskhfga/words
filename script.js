// State Management
let manifest = null;
let currentWords = [];
let queue = [];
let results = {
    correct: 0,
    incorrect: 0,
    wrongCounts: {} // word -> count
};
let settings = {
    direction: 'nl-en',
    mode: 'test',
    bookId: '',
    chapterName: ''
};
let currentItem = null;
let timerTimeout = null;

// TTS Support
const synth = window.speechSynthesis;
let voices = [];

function loadVoices() {
    voices = synth.getVoices();
}
if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = loadVoices;
}
loadVoices();

// DOM Elements
const screens = {
    selection: document.getElementById('selection-screen'),
    list: document.getElementById('list-screen'),
    exercise: document.getElementById('exercise-screen'),
    summary: document.getElementById('summary-screen')
};

const bookGrid = document.getElementById('book-grid');
const chapterGrid = document.getElementById('chapter-grid');
const settingsHeader = document.getElementById('settings-header');
const selectionTitle = document.getElementById('selection-title');
const changeBookBtn = document.getElementById('change-book-btn');

const listTitle = document.getElementById('list-title');
const wordListBody = document.getElementById('word-list-body');
const startPracticeBtn = document.getElementById('start-practice-btn');
const backToChaptersBtn = document.getElementById('back-to-chapters');

const questionWord = document.getElementById('question-word');
const progressText = document.getElementById('progress-text');
const pronounceBtn = document.getElementById('pronounce-btn');

const answerInputContainer = document.getElementById('answer-input-container');
const answerInput = document.getElementById('answer-input');
const mcContainer = document.getElementById('multiple-choice-container');
const mcOptions = document.getElementById('mc-options');
const inMindContainer = document.getElementById('in-mind-container');
const inMindResult = document.getElementById('in-mind-result');
const revealedAnswer = document.getElementById('revealed-answer');

const feedbackContainer = document.getElementById('feedback-container');
const feedbackMessage = document.getElementById('feedback-message');
const correctAnswerDisplay = document.getElementById('correct-answer-display');
const timerBar = document.getElementById('timer-bar');
const nextBtn = document.getElementById('next-btn');
const overrideBtn = document.getElementById('override-correct-btn');

// Initialize App
async function init() {
    try {
        const response = await fetch('data_manifest.json');
        manifest = await response.json();
        populateBookGrid();
    } catch (error) {
        console.error('Failed to load manifest:', error);
    }

    changeBookBtn.addEventListener('click', () => {
        showBookSelection();
    });

    backToChaptersBtn.addEventListener('click', () => showScreen('selection'));
    startPracticeBtn.addEventListener('click', () => startExercise());

    document.getElementById('back-to-selection').addEventListener('click', () => showScreen('selection'));
    document.getElementById('restart-btn').addEventListener('click', () => showScreen('selection'));
    document.getElementById('show-answer-btn').addEventListener('click', showInMindAnswer);
    document.getElementById('correct-btn').addEventListener('click', () => handleAnswer(true));
    document.getElementById('incorrect-btn').addEventListener('click', () => handleAnswer(false));
    document.getElementById('next-btn').addEventListener('click', nextQuestion);
    document.getElementById('override-correct-btn').addEventListener('click', overrideCorrect);
    
    pronounceBtn.addEventListener('click', () => speakWord(questionWord.textContent));

    answerInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !feedbackContainer.classList.contains('hidden')) {
            nextQuestion();
        } else if (e.key === 'Enter') {
            checkTypedAnswer();
        }
    });
}

function populateBookGrid() {
    bookGrid.innerHTML = '';
    manifest.books.forEach(book => {
        const card = document.createElement('div');
        card.className = 'selectable-card';
        card.textContent = book.name;
        card.addEventListener('click', () => selectBook(book));
        bookGrid.appendChild(card);
    });
}

function selectBook(book) {
    settings.bookId = book.id;
    selectionTitle.textContent = `Practicing: ${book.name}`;
    bookGrid.classList.add('hidden');
    chapterGrid.classList.remove('hidden');
    settingsHeader.classList.remove('hidden');
    
    populateChapterGrid(book);
}

function showBookSelection() {
    selectionTitle.textContent = 'Select a Book';
    bookGrid.classList.remove('hidden');
    chapterGrid.classList.add('hidden');
    settingsHeader.classList.add('hidden');
}

function populateChapterGrid(book) {
    chapterGrid.innerHTML = '';
    book.chapters.forEach(chapter => {
        const card = document.createElement('div');
        card.className = 'selectable-card';
        card.textContent = chapter;
        card.addEventListener('click', () => showChapterList(chapter));
        chapterGrid.appendChild(card);
    });
}

function showScreen(screenId) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenId].classList.remove('hidden');
}

async function showChapterList(chapterName) {
    settings.chapterName = chapterName;
    listTitle.textContent = chapterName;
    wordListBody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
    showScreen('list');

    const csvPath = `data/${settings.bookId}/${settings.chapterName}.csv`;
    try {
        const response = await fetch(csvPath);
        const csvText = await response.text();
        currentWords = parseCSV(csvText);
        
        wordListBody.innerHTML = '';
        currentWords.forEach(word => {
            const row = document.createElement('tr');
            row.innerHTML = `<td>${word.dutch}</td><td>${word.english}</td>`;
            wordListBody.appendChild(row);
        });

        if (currentWords.length === 0) {
            wordListBody.innerHTML = '<tr><td colspan="2">No words found in this section.</td></tr>';
        }
    } catch (error) {
        console.error('Failed to load CSV:', error);
        wordListBody.innerHTML = '<tr><td colspan="2">Failed to load data.</td></tr>';
    }
}

async function startExercise() {
    if (currentWords.length === 0) {
        alert('No words to practice.');
        return;
    }

    // Read current settings from header
    settings.direction = document.querySelector('input[name="direction"]:checked').value;
    settings.mode = document.querySelector('input[name="mode"]:checked').value;

    // Initialize queue with all words shuffled
    queue = [...currentWords].sort(() => Math.random() - 0.5).map(w => ({ ...w, failCount: 0 }));
    results = { correct: 0, incorrect: 0, wrongCounts: {} };
    
    showScreen('exercise');
    nextQuestion();
}

function parseCSV(text) {
    const lines = text.split('\n');
    const words = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        // Handle potential commas in quotes
        const parts = [];
        let currentPart = '';
        let inQuotes = false;
        
        for (let char of lines[i]) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                parts.push(currentPart.trim());
                currentPart = '';
            } else {
                currentPart += char;
            }
        }
        parts.push(currentPart.trim());

        if (parts.length >= 2) {
            words.push({
                dutch: parts[0],
                english: parts[1]
            });
        }
    }
    return words;
}

function nextQuestion() {
    if (timerTimeout) clearTimeout(timerTimeout);
    
    if (queue.length === 0) {
        showSummary();
        return;
    }

    currentItem = queue.shift();
    updateUIForQuestion();
}

function updateUIForQuestion() {
    const question = settings.direction === 'nl-en' ? currentItem.dutch : currentItem.english;
    questionWord.textContent = question;
    progressText.textContent = `Words remaining: ${queue.length + 1}`;

    // Reset UI
    feedbackContainer.classList.add('hidden');
    timerBar.style.transition = 'none';
    timerBar.style.width = '0%';
    
    document.querySelectorAll('.mode-container').forEach(c => c.classList.add('hidden'));
    
    if (settings.mode === 'test') {
        answerInputContainer.classList.remove('hidden');
        answerInput.value = '';
        answerInput.focus();
    } else if (settings.mode === 'multiple-choice') {
        mcContainer.classList.remove('hidden');
        generateMCOptions();
    } else if (settings.mode === 'in-mind') {
        inMindContainer.classList.remove('hidden');
        inMindResult.classList.add('hidden');
        document.getElementById('show-answer-btn').classList.remove('hidden');
    }
}

function speakWord(text) {
    if (!synth) return;
    
    // Stop any current speech
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const lang = settings.direction === 'nl-en' ? 'nl-NL' : 'en-US';
    
    // Try to find a specific voice for the language
    const preferredVoice = voices.find(v => v.lang.startsWith(lang.split('-')[0]));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.lang = lang;
    
    synth.speak(utterance);
}

function generateMCOptions() {
    const correct = settings.direction === 'nl-en' ? currentItem.english : currentItem.dutch;
    let options = [correct];
    
    const others = currentWords
        .map(w => settings.direction === 'nl-en' ? w.english : w.dutch)
        .filter((val, index, self) => val !== correct && self.indexOf(val) === index); // Unique others
    
    const shuffledOthers = others.sort(() => Math.random() - 0.5);
    const numOthers = Math.min(3, shuffledOthers.length);
    options.push(...shuffledOthers.slice(0, numOthers));
    
    options.sort(() => Math.random() - 0.5);
    
    mcOptions.innerHTML = options.map(opt => `<div class="mc-option">${opt}</div>`).join('');
    
    document.querySelectorAll('.mc-option').forEach(el => {
        el.addEventListener('click', () => {
            if (!feedbackContainer.classList.contains('hidden')) return;
            handleAnswer(el.textContent === correct, el);
        });
    });
}

function showInMindAnswer() {
    const answer = settings.direction === 'nl-en' ? currentItem.english : currentItem.dutch;
    revealedAnswer.textContent = answer;
    inMindResult.classList.remove('hidden');
    document.getElementById('show-answer-btn').classList.add('hidden');
}

function checkTypedAnswer() {
    const correct = settings.direction === 'nl-en' ? currentItem.english : currentItem.dutch;
    const userAns = answerInput.value.trim();
    
    // Better normalization: remove punctuation, smart quotes, and extra whitespace
    const normalize = (s) => s.toLowerCase()
        .replace(/[.,!?;:’'"]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const normalizedUser = normalize(userAns);
    const normalizedCorrect = normalize(correct);
    
    // Split by comma for synonyms, but also include the full string as a valid option
    const possibleAnswers = correct.split(',').map(normalize);
    possibleAnswers.push(normalizedCorrect);
    
    const isCorrect = possibleAnswers.includes(normalizedUser);
    
    handleAnswer(isCorrect);
}

function handleAnswer(isCorrect, element = null) {
    if (isCorrect) {
        results.correct++;
        if (settings.mode === 'in-mind') {
            nextQuestion();
            return;
        }
        feedbackMessage.textContent = 'Correct!';
        feedbackMessage.style.color = 'var(--success-color)';
        correctAnswerDisplay.classList.add('hidden');
        overrideBtn.classList.add('hidden');
        
        if (element) element.classList.add('correct');
        
        startTimer();
    } else {
        results.incorrect++;
        results.wrongCounts[currentItem.dutch] = (results.wrongCounts[currentItem.dutch] || 0) + 1;
        
        // Re-insert into queue
        currentItem.failCount++;
        const delay = currentItem.failCount; 
        const insertAt = Math.min(queue.length, delay);
        queue.splice(insertAt, 0, currentItem);

        if (settings.mode === 'in-mind') {
            nextQuestion();
            return;
        }

        feedbackMessage.textContent = 'Incorrect';
        feedbackMessage.style.color = 'var(--danger-color)';
        
        const answer = settings.direction === 'nl-en' ? currentItem.english : currentItem.dutch;
        correctAnswerDisplay.textContent = `Correct answer: ${answer}`;
        correctAnswerDisplay.classList.remove('hidden');
        
        if (settings.mode === 'test') {
            overrideBtn.classList.remove('hidden');
        } else {
            overrideBtn.classList.add('hidden');
        }

        if (element) element.classList.add('incorrect');
    }

    feedbackContainer.classList.remove('hidden');
    
    // Ensure feedback is visible on mobile when keyboard is up
    setTimeout(() => {
        feedbackContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

function startTimer() {
    timerBar.style.transition = 'none';
    timerBar.style.width = '0%';
    setTimeout(() => {
        timerBar.style.transition = 'width 3s linear';
        timerBar.style.width = '100%';
    }, 10);

    timerTimeout = setTimeout(() => {
        nextQuestion();
    }, 3000);
}

function overrideCorrect() {
    if (timerTimeout) clearTimeout(timerTimeout);
    
    // Correct results
    results.correct++;
    results.incorrect--;
    results.wrongCounts[currentItem.dutch]--;
    if (results.wrongCounts[currentItem.dutch] <= 0) delete results.wrongCounts[currentItem.dutch];
    
    // Remove from queue
    const index = queue.indexOf(currentItem);
    if (index > -1) {
        queue.splice(index, 1);
    }

    feedbackMessage.textContent = 'Correct! (Overridden)';
    feedbackMessage.style.color = 'var(--success-color)';
    correctAnswerDisplay.classList.add('hidden');
    overrideBtn.classList.add('hidden');
    
    startTimer();
}

function showSummary() {
    showScreen('summary');
    document.getElementById('summary-correct').textContent = results.correct;
    document.getElementById('summary-incorrect').textContent = results.incorrect;
    
    const difficultList = document.getElementById('difficult-words-list');
    difficultList.innerHTML = '';
    
    const sortedWrong = Object.entries(results.wrongCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
        
    if (sortedWrong.length === 0) {
        difficultList.innerHTML = '<li>None! Great job!</li>';
    } else {
        sortedWrong.forEach(([word, count]) => {
            const li = document.createElement('li');
            li.textContent = `${word}: ${count} mistakes`;
            difficultList.appendChild(li);
        });
    }
}

init();
