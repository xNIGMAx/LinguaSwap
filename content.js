// Translation Service
const translationService = {
  MYMEMORY_API_URL: 'https://api.mymemory.translated.net/get',

  async translateWord(word, targetLanguage) {
    console.log(`Translating word: "${word}" to ${targetLanguage}`);
    try {
      const url = `${this.MYMEMORY_API_URL}?q=${encodeURIComponent(word)}&langpair=en|${targetLanguage}`;
      console.log('API URL:', url);
      
      const response = await fetch(url);
      const data = await response.json();
      console.log('API Response:', data);

      if (!response.ok) {
        console.error('Translation failed:', data.responseStatus);
        throw new Error(`Translation failed: ${data.responseStatus}`);
      }

      // MyMemory API returns a match quality between 0-100
      const quality = data.responseData.match || 0;
      const normalizedQuality = quality / 100; // Convert to 0-1 scale

      console.log('Translation result:', {
        original: word,
        translation: data.responseData.translatedText,
        quality: normalizedQuality
      });

      return {
        translation: data.responseData.translatedText,
        quality: normalizedQuality,
        source: 'mymemory'
      };
    } catch (error) {
      console.error('Translation error:', error);
      throw error;
    }
  },

  async checkDailyLimit() {
    try {
      console.log('Checking daily translation limit...');
      const response = await fetch(`${this.MYMEMORY_API_URL}?q=test&langpair=en|es`);
      const data = await response.json();
      
      const limitReached = data.responseStatus?.includes('Daily limit') || false;
      console.log('Daily limit reached?', limitReached);
      
      return limitReached;
    } catch (error) {
      console.error('Error checking daily limit:', error);
      return true; // Assume limit reached on error
    }
  }
};

// Configuration
let config = {
  enabled: false,
  targetLanguage: 'es',
  difficulty: 1,
  excludedTags: ['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'INPUT'],
  translationCache: new Map(),
  replacedWords: new Set(),
  wordSource: 'api',
  customWords: null,
  learningThreshold: 5,
  wordStats: new Map(),
  minTranslationQuality: 0.75,
  translationFailures: new Map(),
  maxRetries: 3,
  maxWordsPerPage: 20, // Maximum words to translate per page
  isProcessing: false // Flag to prevent multiple simultaneous processing
};

// Difficulty settings
const DIFFICULTY_SETTINGS = {
  1: { wordsPerParagraph: 5, minWordLength: 4 }, // Beginner
  2: { wordsPerParagraph: 10, minWordLength: 3 }, // Intermediate
  3: { wordsPerParagraph: 20, minWordLength: 3 }  // Advanced
};

// Initialize content script
async function initialize() {
  const state = await chrome.storage.local.get(['languageLearningState', 'customWords']);
  if (state.languageLearningState) {
    config.enabled = state.languageLearningState.enabled;
    config.targetLanguage = state.languageLearningState.targetLanguage;
    config.difficulty = state.languageLearningState.difficulty;
    config.wordSource = state.languageLearningState.wordSource || 'api';
  }
  if (state.customWords) {
    config.customWords = state.customWords;
  }

  if (config.enabled) {
    processPage();
  }
}

// Process the page content
async function processPage() {
  if (config.isProcessing) {
    console.log('Already processing page, skipping...');
    return;
  }

  config.isProcessing = true;
  console.log('Starting page processing...');

  try {
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (
            !config.excludedTags.includes(node.parentElement?.tagName) &&
            node.textContent.trim().length > 0 &&
            !node.parentElement?.closest('.language-learning-word') // Don't process already translated words
          ) {
            return NodeFilter.FILTER_ACCEPT;
          }
          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    await processTextNodes(textNodes);
  } finally {
    config.isProcessing = false;
    console.log('Page processing complete.');
  }
}

// Process text nodes and replace words
async function processTextNodes(nodes) {
  const difficultyConfig = DIFFICULTY_SETTINGS[config.difficulty];
  console.log('Current config:', {
    targetLanguage: config.targetLanguage,
    wordSource: config.wordSource,
    difficulty: config.difficulty,
    replacedWordsCount: config.replacedWords.size
  });

  // If we've already translated enough words, stop
  if (config.replacedWords.size >= config.maxWordsPerPage) {
    console.log('Maximum words per page reached, stopping translations');
    return;
  }

  // Collect all eligible words first
  const allEligibleWords = new Set();
  for (const node of nodes) {
    const text = node.textContent;
    const words = text.match(/\b\w+\b/g) || [];
    
    words.forEach(word => {
      const wordLower = word.toLowerCase();
      const meetsLengthRequirement = word.length >= difficultyConfig.minWordLength;
      const notReplaced = !config.replacedWords.has(wordLower);
      
      if (config.wordSource === 'custom') {
        if (meetsLengthRequirement && notReplaced && config.customWords && wordLower in config.customWords) {
          allEligibleWords.add(word);
        }
      } else {
        if (meetsLengthRequirement && notReplaced) {
          allEligibleWords.add(word);
        }
      }
    });
  }

  // Randomly select words to translate up to the maximum
  const remainingSlots = config.maxWordsPerPage - config.replacedWords.size;
  const wordsToTranslate = selectRandomWords(
    Array.from(allEligibleWords),
    Math.min(remainingSlots, difficultyConfig.wordsPerParagraph * 3)
  );

  console.log(`Selected ${wordsToTranslate.length} words for translation`);

  // Create a map of translations
  const translations = new Map();
  for (const word of wordsToTranslate) {
    try {
      const result = await translationService.translateWord(word, config.targetLanguage);
      if (result) {
        translations.set(word, result.translation);
        config.replacedWords.add(word.toLowerCase());
      }
    } catch (error) {
      console.error('Translation error:', error);
    }
  }

  // Replace all instances of translated words
  for (const node of nodes) {
    if (!node.parentElement) continue;

    let content = node.textContent;
    let hasChanges = false;

    for (const [word, translation] of translations) {
      const regex = new RegExp(`\\b${word}\\b`, 'g');
      if (regex.test(content)) {
        const replacement = createReplacementElement(word, translation);
        content = content.replace(regex, replacement.outerHTML);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = content;
      while (tempDiv.firstChild) {
        node.parentElement.insertBefore(tempDiv.firstChild, node);
      }
      node.parentElement.removeChild(node);
    }
  }
}

// Select random words to replace
function selectRandomWords(words, count) {
  const shuffled = words.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(count, words.length));
}

// Create replacement element with hover functionality
function createReplacementElement(original, translation) {
  const span = document.createElement('span');
  const wordLower = original.toLowerCase();
  
  // Initialize or get word stats
  if (!config.wordStats.has(wordLower)) {
    config.wordStats.set(wordLower, {
      exposures: 0,        // Times seen
      reveals: 0,          // Times hovered to see original
      correctRecalls: 0,   // Times recalled correctly
      lastSeen: null,      // Last interaction date
      stage: 'new',        // Learning stage: new, learning, reviewing, mastered
      confidence: 0        // Learning confidence (0-100)
    });
  }

  const stats = config.wordStats.get(wordLower);
  stats.exposures++;
  stats.lastSeen = new Date().toISOString();

  // Set initial classes based on learning stage
  const stageClasses = {
    new: 'new',
    learning: 'learning',
    reviewing: 'reviewing',
    mastered: 'learned'
  };
  
  span.className = `language-learning-word ${stageClasses[stats.stage]}`;
  span.textContent = translation;
  span.dataset.original = original;
  
  // Handle category and confidence data based on word source
  if (config.wordSource === 'custom' && config.customWords?.[wordLower]) {
    span.dataset.category = config.customWords[wordLower].category || 'common';
  } else {
    span.dataset.category = 'api';
  }
  
  span.dataset.confidence = stats.confidence;
  span.title = `${original} (${span.dataset.category}) - Confidence: ${stats.confidence}%`;

  // Track hover time for reveals
  let hoverStartTime = null;
  span.addEventListener('mouseenter', () => {
    hoverStartTime = Date.now();
  });

  span.addEventListener('mouseleave', () => {
    if (hoverStartTime) {
      const hoverDuration = Date.now() - hoverStartTime;
      if (hoverDuration > 500) { // Only count reveals longer than 500ms
        stats.reveals++;
        updateLearningProgress(wordLower, 'reveal');
      }
      hoverStartTime = null;
    }
  });

  // Add click handler for active recall
  span.addEventListener('click', async (e) => {
    e.preventDefault();
    
    // Show quiz popup
    const quiz = createQuizPopup(original, translation);
    document.body.appendChild(quiz);
    
    // Position the quiz popup near the word
    const rect = span.getBoundingClientRect();
    quiz.style.top = `${rect.bottom + window.scrollY + 10}px`;
    quiz.style.left = `${rect.left + window.scrollX}px`;
  });

  return span;
}

// Create quiz popup for active recall
function createQuizPopup(original, translation) {
  const popup = document.createElement('div');
  popup.className = 'language-learning-quiz';
  
  const wordLower = original.toLowerCase();
  const stats = config.wordStats.get(wordLower);
  
  popup.innerHTML = `
    <div class="quiz-content">
      <p>Do you remember this word?</p>
      <p class="quiz-word">${translation}</p>
      <div class="quiz-buttons">
        <button class="show-answer">Show Answer</button>
        <div class="confidence-buttons" style="display: none;">
          <button data-confidence="0">Don't Know</button>
          <button data-confidence="33">Hard</button>
          <button data-confidence="66">Good</button>
          <button data-confidence="100">Easy</button>
        </div>
      </div>
      <div class="quiz-stats">
        <span>Seen: ${stats.exposures} times</span>
        <span>Confidence: ${stats.confidence}%</span>
      </div>
    </div>
  `;

  // Add event listeners
  const showAnswerBtn = popup.querySelector('.show-answer');
  const confidenceButtons = popup.querySelector('.confidence-buttons');
  
  showAnswerBtn.addEventListener('click', () => {
    showAnswerBtn.textContent = original;
    confidenceButtons.style.display = 'flex';
  });

  confidenceButtons.addEventListener('click', async (e) => {
    if (e.target.tagName === 'BUTTON') {
      const confidence = parseInt(e.target.dataset.confidence);
      await updateLearningProgress(wordLower, 'recall', confidence);
      popup.remove();
    }
  });

  // Close popup when clicking outside
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target) && !e.target.classList.contains('language-learning-word')) {
      popup.remove();
    }
  });

  return popup;
}

// Update learning progress
async function updateLearningProgress(word, interactionType, confidence = null) {
  const stats = config.wordStats.get(word);
  const oldStage = stats.stage;

  if (interactionType === 'recall') {
    stats.correctRecalls++;
    stats.confidence = confidence;

    // Update learning stage based on confidence and recalls
    if (confidence === 100 && stats.correctRecalls >= config.learningThreshold) {
      stats.stage = 'mastered';
    } else if (confidence >= 66) {
      stats.stage = 'reviewing';
    } else if (confidence >= 33) {
      stats.stage = 'learning';
    } else {
      stats.stage = 'new';
    }
  } else if (interactionType === 'reveal') {
    // Decrease confidence slightly when user needs to reveal the word
    stats.confidence = Math.max(0, stats.confidence - 5);
  }

  // Save progress
  await saveProgress(word, stats);

  // Update UI if stage changed
  if (oldStage !== stats.stage) {
    document.querySelectorAll(`.language-learning-word[data-original="${word}"]`).forEach(el => {
      el.className = `language-learning-word ${stats.stage}`;
      el.dataset.confidence = stats.confidence;
    });
  }
}

// Save progress to storage
async function saveProgress(word, stats) {
  const vocabulary = await chrome.storage.local.get('learnedVocabulary');
  const learnedVocabulary = vocabulary.learnedVocabulary || {};
  
  learnedVocabulary[word] = {
    ...config.customWords[word],
    stats: {
      ...stats,
      lastUpdated: new Date().toISOString()
    }
  };

  await chrome.storage.local.set({ learnedVocabulary });
  
  // Notify popup about progress update
  chrome.runtime.sendMessage({
    type: 'progressUpdate',
    word,
    stats
  });
}

// Translation function with caching
async function translateWord(word) {
  const wordLower = word.toLowerCase();
  
  // First check custom words
  if (config.customWords && wordLower in config.customWords) {
    return {
      translation: config.customWords[wordLower].translation,
      source: 'custom'
    };
  }

  // Check cache
  if (config.translationCache.has(wordLower)) {
    return {
      translation: config.translationCache.get(wordLower),
      source: 'cache'
    };
  }

  // Check if word has failed too many times
  const failures = config.translationFailures.get(wordLower) || 0;
  if (failures >= config.maxRetries) {
    return null;
  }

  try {
    const result = await translationService.translateWord(word, config.targetLanguage);
    
    // Only cache high-quality translations
    if (result.quality >= config.minTranslationQuality) {
      config.translationCache.set(wordLower, result.translation);
      return {
        translation: result.translation,
        source: 'api',
        quality: result.quality
      };
    } else {
      // Track low-quality translation as a failure
      const currentFailures = config.translationFailures.get(wordLower) || 0;
      config.translationFailures.set(wordLower, currentFailures + 1);
      return null;
    }
  } catch (error) {
    // Handle API errors
    if (error.message.includes('Daily limit')) {
      config.wordSource = 'custom'; // Fall back to custom words only
      chrome.runtime.sendMessage({
        type: 'showNotification',
        message: 'Daily translation limit reached. Switching to custom words only.'
      });
    }
    
    // Track failure
    const currentFailures = config.translationFailures.get(wordLower) || 0;
    config.translationFailures.set(wordLower, currentFailures + 1);
    
    console.error(`Translation failed for word: ${word}`, error);
    return null;
  }
}

// Update the word replacement function to handle the new translation response format
async function replaceWordWithTranslation(textNode, word) {
  const result = await translateWord(word);
  
  if (!result || !result.translation) {
    return false;
  }

  const span = document.createElement('span');
  span.className = 'language-learning-word';
  span.textContent = result.translation;
  span.dataset.original = word;
  span.dataset.source = result.source;
  if (result.quality) {
    span.dataset.quality = result.quality;
  }

  // Replace the original word with the translated span
  const regex = new RegExp(`\\b${word}\\b`, 'i');
  const newContent = textNode.textContent.replace(regex, span.outerHTML);
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = newContent;
  
  while (tempDiv.firstChild) {
    textNode.parentNode.insertBefore(tempDiv.firstChild, textNode);
  }
  textNode.parentNode.removeChild(textNode);
  
  return true;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message);
  switch (message.type) {
    case 'toggleTranslation':
      config.enabled = message.enabled;
      if (config.enabled) {
        processPage();
      } else {
        // Remove translations
        document.querySelectorAll('.language-learning-word').forEach(el => {
          el.outerHTML = el.dataset.original;
        });
      }
      break;

    case 'updateLanguage':
      config.targetLanguage = message.language;
      console.log('Language updated to:', config.targetLanguage);
      if (config.enabled) {
        // Clear existing translations when language changes
        document.querySelectorAll('.language-learning-word').forEach(el => {
          el.outerHTML = el.dataset.original;
        });
        config.replacedWords.clear();
        config.translationCache.clear();
        processPage();
      }
      break;

    case 'updateDifficulty':
      config.difficulty = message.difficulty;
      if (config.enabled) {
        config.replacedWords.clear();
        processPage();
      }
      break;

    case 'updateWordSource':
      config.wordSource = message.source;
      if (message.words) {
        config.customWords = message.words;
      }
      if (config.enabled) {
        // Clear existing translations when source changes
        document.querySelectorAll('.language-learning-word').forEach(el => {
          el.outerHTML = el.dataset.original;
        });
        config.replacedWords.clear();
        config.translationCache.clear();
        processPage();
      }
      break;

    case 'updateCustomWords':
      config.customWords = message.words;
      if (config.enabled && config.wordSource === 'custom') {
        config.replacedWords.clear();
        processPage();
      }
      break;
  }
});

// Add stylesheet for translations
const style = document.createElement('style');
style.textContent = `
  .language-learning-word {
    display: inline-block;
    padding: 2px 8px;
    margin: 0 2px;
    border-radius: 6px;
    background: linear-gradient(135deg, #6C63FF11, #6C63FF22);
    color: #6C63FF;
    font-weight: 500;
    cursor: help;
    position: relative;
    border: 2px solid #6C63FF33;
    box-shadow: 0 2px 4px rgba(108, 99, 255, 0.1);
    transition: all 0.3s ease;
  }

  .language-learning-word::before {
    content: attr(data-original);
    position: absolute;
    top: -30px;
    left: 50%;
    transform: translateX(-50%) scale(0.9);
    background-color: #2D3748;
    color: white;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
    white-space: nowrap;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    z-index: 1000;
  }

  .language-learning-word::after {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 6px solid #2D3748;
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
    z-index: 1000;
  }

  .language-learning-word:hover {
    transform: translateY(-1px);
    background: linear-gradient(135deg, #6C63FF22, #6C63FF33);
    box-shadow: 0 4px 8px rgba(108, 99, 255, 0.15);
  }

  .language-learning-word:hover::before,
  .language-learning-word:hover::after {
    opacity: 1;
    visibility: visible;
    transform: translateX(-50%) scale(1);
  }

  .language-learning-word.new {
    animation: popIn 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  }

  @keyframes popIn {
    0% {
      transform: scale(0.8);
      opacity: 0;
    }
    50% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .language-learning-word.learned {
    background: linear-gradient(135deg, #4CAF5011, #4CAF5022);
    color: #4CAF50;
    border-color: #4CAF5033;
  }

  .language-learning-word.learned:hover {
    background: linear-gradient(135deg, #4CAF5022, #4CAF5033);
    box-shadow: 0 4px 8px rgba(76, 175, 80, 0.15);
  }

  /* Different colors for different word categories */
  .language-learning-word[data-category="verbs"] {
    background: linear-gradient(135deg, #FF6B6B11, #FF6B6B22);
    color: #FF6B6B;
    border-color: #FF6B6B33;
  }

  .language-learning-word[data-category="nouns"] {
    background: linear-gradient(135deg, #4ECDC411, #4ECDC422);
    color: #4ECDC4;
    border-color: #4ECDC433;
  }

  .language-learning-word[data-category="adjectives"] {
    background: linear-gradient(135deg, #FFD93D11, #FFD93D22);
    color: #FF9F1C;
    border-color: #FFD93D33;
  }

  .language-learning-word[data-category="pronouns"] {
    background: linear-gradient(135deg, #95A5A611, #95A5A622);
    color: #95A5A6;
    border-color: #95A5A633;
  }

  /* Mobile optimization */
  @media (max-width: 768px) {
    .language-learning-word::before {
      top: auto;
      bottom: -30px;
    }

    .language-learning-word::after {
      top: auto;
      bottom: -6px;
      border-top: none;
      border-bottom: 6px solid #2D3748;
    }
  }

  /* High contrast mode */
  @media (prefers-contrast: high) {
    .language-learning-word {
      background: #6C63FF !important;
      color: white !important;
      border: 2px solid #6C63FF !important;
    }

    .language-learning-word.learned {
      background: #4CAF50 !important;
      border-color: #4CAF50 !important;
    }
  }

  /* Reduced motion */
  @media (prefers-reduced-motion: reduce) {
    .language-learning-word {
      transition: none;
    }

    .language-learning-word.new {
      animation: none;
    }
  }

  .language-learning-quiz {
    position: absolute;
    z-index: 1000;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    padding: 16px;
    max-width: 300px;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .quiz-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .quiz-word {
    font-size: 1.2em;
    font-weight: 600;
    color: var(--primary-color);
    text-align: center;
  }

  .quiz-buttons {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .confidence-buttons {
    display: none;
    flex-wrap: wrap;
    gap: 8px;
  }

  .quiz-buttons button {
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .show-answer {
    background: var(--primary-color);
    color: white;
  }

  .confidence-buttons button {
    flex: 1 1 calc(50% - 4px);
    background: #f0f0f0;
  }

  .confidence-buttons button:hover {
    background: #e0e0e0;
  }

  .quiz-stats {
    font-size: 0.9em;
    color: #666;
    display: flex;
    justify-content: space-between;
  }

  /* Update existing word styles to show confidence */
  .language-learning-word {
    border-width: 2px;
  }

  .language-learning-word[data-confidence="100"] {
    border-style: solid;
  }

  .language-learning-word[data-confidence="66"] {
    border-style: dashed;
  }

  .language-learning-word[data-confidence="33"] {
    border-style: dotted;
  }

  .language-learning-word[data-confidence="0"] {
    border-style: double;
  }
`;
document.head.appendChild(style);

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
} 