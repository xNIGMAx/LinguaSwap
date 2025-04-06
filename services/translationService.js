// MyMemory Translation Service
const MYMEMORY_API_URL = 'https://api.mymemory.translated.net/get';

/**
 * Translates a word using the MyMemory API
 * @param {string} word - The word to translate
 * @param {string} targetLanguage - The target language code (e.g., 'es', 'fr')
 * @returns {Promise<{translation: string, quality: number}>}
 */
async function translateWord(word, targetLanguage) {
  console.log(`Translating word: "${word}" to ${targetLanguage}`);
  try {
    const url = `${MYMEMORY_API_URL}?q=${encodeURIComponent(word)}&langpair=en|${targetLanguage}`;
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
}

/**
 * Checks if the daily translation limit has been reached
 * @returns {Promise<boolean>}
 */
async function checkDailyLimit() {
  try {
    console.log('Checking daily translation limit...');
    const response = await fetch(`${MYMEMORY_API_URL}?q=test&langpair=en|es`);
    const data = await response.json();
    
    const limitReached = data.responseStatus?.includes('Daily limit') || false;
    console.log('Daily limit reached?', limitReached);
    
    return limitReached;
  } catch (error) {
    console.error('Error checking daily limit:', error);
    return true; // Assume limit reached on error
  }
}

export default {
  translateWord,
  checkDailyLimit
}; 