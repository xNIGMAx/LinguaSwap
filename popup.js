// State management
let state = {
  enabled: false,
  targetLanguage: 'es',
  difficulty: 1,
  wordsLearned: 0,
  streak: 0,
  lastActive: null,
  wordSource: 'api', // 'api' or 'custom'
  customWords: null,
  theme: 'light' // Add theme to state
};

// DOM Elements
const elements = {
  enabled: document.getElementById('enabled'),
  targetLanguage: document.getElementById('targetLanguage'),
  difficulty: document.getElementById('difficulty'),
  wordsLearned: document.getElementById('wordsLearned'),
  streak: document.getElementById('streak'),
  exportVocab: document.getElementById('exportVocab'),
  settings: document.getElementById('settings'),
  apiSource: document.getElementById('apiSource'),
  customSource: document.getElementById('customSource'),
  customWordSection: document.getElementById('customWordSection'),
  wordFile: document.getElementById('wordFile'),
  downloadTemplate: document.getElementById('downloadTemplate'),
  themeToggle: document.getElementById('themeToggle') // Add theme toggle button
};

// Initialize popup
async function initializePopup() {
  // Load saved state
  const savedState = await chrome.storage.local.get(['languageLearningState', 'customWords']);
  if (savedState.languageLearningState) {
    state = { ...state, ...savedState.languageLearningState };
  }
  if (savedState.customWords) {
    state.customWords = savedState.customWords;
  }

  // Update UI with saved state
  elements.enabled.checked = state.enabled;
  elements.targetLanguage.value = state.targetLanguage;
  elements.difficulty.value = state.difficulty;
  elements.wordsLearned.textContent = state.wordsLearned;
  elements.streak.textContent = state.streak;

  // Update word source UI
  updateWordSourceUI(state.wordSource);

  // Update difficulty labels
  updateDifficultyLabel();

  // Update streak
  updateStreak();

  // Apply theme
  applyTheme(state.theme);

  // Add animation classes
  document.querySelectorAll('.card').forEach(card => {
    card.classList.add('animate-in');
  });
}

// Update word source UI
function updateWordSourceUI(source) {
  elements.apiSource.classList.toggle('active', source === 'api');
  elements.customSource.classList.toggle('active', source === 'custom');
  elements.customWordSection.style.display = source === 'custom' ? 'block' : 'none';
}

// Update difficulty label based on slider value
function updateDifficultyLabel() {
  const value = parseInt(elements.difficulty.value);
  const labels = ['Beginner', 'Intermediate', 'Advanced'];
  document.querySelectorAll('.difficulty-labels span').forEach((span, index) => {
    span.classList.toggle('active', index === value - 1);
  });
}

// Process custom word list
async function processWordList(file) {
  const text = await file.text();
  const rows = text.split('\n').map(row => row.split(','));
  const headers = rows[0];
  const words = {};

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.length >= 2) {
      words[row[0].trim()] = {
        translation: row[1].trim(),
        language: row[2]?.trim() || state.targetLanguage,
        category: row[3]?.trim() || 'general',
        notes: row[4]?.trim() || ''
      };
    }
  }

  state.customWords = words;
  await chrome.storage.local.set({ customWords: words });
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'updateCustomWords',
    words: words
  });
}

// Update streak based on daily activity
function updateStreak() {
  const today = new Date().toDateString();
  if (state.lastActive !== today) {
    state.lastActive = today;
    state.streak = state.streak + 1;
    elements.streak.textContent = state.streak;
    
    // Add animation
    elements.streak.classList.add('bounce');
    setTimeout(() => elements.streak.classList.remove('bounce'), 1000);
    
    saveState();
  }
}

// Save state to storage
async function saveState() {
  await chrome.storage.local.set({
    languageLearningState: state
  });
}

// Event Listeners
elements.enabled.addEventListener('change', async (e) => {
  state.enabled = e.target.checked;
  await saveState();
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'toggleTranslation',
    enabled: state.enabled
  });
});

elements.targetLanguage.addEventListener('change', async (e) => {
  state.targetLanguage = e.target.value;
  await saveState();
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'updateLanguage',
    language: state.targetLanguage
  });
});

elements.difficulty.addEventListener('input', async (e) => {
  state.difficulty = parseInt(e.target.value);
  updateDifficultyLabel();
  await saveState();
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'updateDifficulty',
    difficulty: state.difficulty
  });
});

elements.apiSource.addEventListener('click', async () => {
  state.wordSource = 'api';
  updateWordSourceUI('api');
  await saveState();
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'updateWordSource',
    source: 'api'
  });
});

elements.customSource.addEventListener('click', async () => {
  state.wordSource = 'custom';
  updateWordSourceUI('custom');
  await saveState();
  
  // Notify content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    type: 'updateWordSource',
    source: 'custom',
    words: state.customWords
  });
});

elements.wordFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    await processWordList(file);
    // Update file name display
    const fileName = document.querySelector('.file-name');
    fileName.textContent = file.name;
    fileName.classList.add('file-uploaded');
  }
});

elements.downloadTemplate.addEventListener('click', (e) => {
  e.preventDefault();
  const link = document.createElement('a');
  link.href = 'word-list-template.csv';
  link.download = 'word-list-template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

elements.exportVocab.addEventListener('click', async () => {
  const vocabulary = await chrome.storage.local.get('learnedVocabulary');
  if (vocabulary.learnedVocabulary) {
    const csvContent = [
      ['Original', 'Translation', 'Language', 'Learned At'],
      ...Object.entries(vocabulary.learnedVocabulary).map(([word, data]) => [
        word,
        data.translation,
        data.language,
        data.learnedAt
      ])
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vocabulary.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
});

elements.settings.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'wordLearned') {
    state.wordsLearned++;
    elements.wordsLearned.textContent = state.wordsLearned;
    
    // Add animation
    elements.wordsLearned.classList.add('bounce');
    setTimeout(() => elements.wordsLearned.classList.remove('bounce'), 1000);
    
    saveState();
  }
});

// Apply theme function
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  state.theme = theme;
  saveState();
}

// Add theme toggle event listener
elements.themeToggle.addEventListener('click', () => {
  const newTheme = state.theme === 'light' ? 'dark' : 'light';
  applyTheme(newTheme);
});

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', initializePopup); 