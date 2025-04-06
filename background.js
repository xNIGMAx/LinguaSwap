// Initialize extension when installed
chrome.runtime.onInstalled.addListener(async () => {
  // Set default state
  const defaultState = {
    enabled: false,
    targetLanguage: 'es',
    difficulty: 'beginner',
    wordsLearned: 0,
    streak: 0,
    lastActive: null
  };

  await chrome.storage.local.set({
    languageLearningState: defaultState,
    learnedVocabulary: {}
  });

  // Create context menu for quick translation
  chrome.contextMenus.create({
    id: 'translateSelection',
    title: 'Translate Selection',
    contexts: ['selection']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translateSelection') {
    const state = await chrome.storage.local.get('languageLearningState');
    const targetLanguage = state.languageLearningState?.targetLanguage || 'es';

    // Send message to content script to translate selection
    chrome.tabs.sendMessage(tab.id, {
      type: 'translateSelection',
      text: info.selectionText,
      targetLanguage
    });
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'wordLearned') {
    // Update badge with number of words learned
    chrome.action.setBadgeText({
      text: message.count?.toString() || ''
    });
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    // Check if we should initialize translation on this page
    chrome.storage.local.get('languageLearningState', (data) => {
      if (data.languageLearningState?.enabled) {
        chrome.tabs.sendMessage(tabId, {
          type: 'initializeTranslation',
          config: data.languageLearningState
        });
      }
    });
  }
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // Toggle extension state
  chrome.storage.local.get('languageLearningState', async (data) => {
    const newState = {
      ...data.languageLearningState,
      enabled: !data.languageLearningState?.enabled
    };

    await chrome.storage.local.set({ languageLearningState: newState });

    // Update icon to reflect state
    chrome.action.setIcon({
      path: newState.enabled ? {
        16: 'icons/icon16-active.png',
        48: 'icons/icon48-active.png',
        128: 'icons/icon128-active.png'
      } : {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
      }
    });

    // Notify content script
    chrome.tabs.sendMessage(tab.id, {
      type: 'toggleTranslation',
      enabled: newState.enabled
    });
  });
});

// Add to existing listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'showNotification') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'LinguaSwap',
      message: message.message
    });
  }
}); 