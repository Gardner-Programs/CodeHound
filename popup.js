const isFirefox = typeof browser !== 'undefined';
const api = isFirefox ? browser : chrome;

const CLIENT_ID = '924033159870-g4guhjc65ps1i7vbqcgteai666hv04pb.apps.googleusercontent.com';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const DEFAULT_QUERY = 'is:unread newer_than:1h (subject:code OR subject:verify OR subject:verification OR subject:OTP OR subject:"one-time" OR subject:authentication OR subject:confirmation OR subject:security)';
const AI_EMAIL_SCAN_COUNT = 5;

// DOM
const retrieveBtn = document.getElementById('retrieveBtn');
const searchQueryInput = document.getElementById('searchQuery');
const resultEl = document.getElementById('result');
const codeDisplay = document.getElementById('codeDisplay');
const resultLabel = document.getElementById('resultLabel');
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const aiToggle = document.getElementById('aiToggle');
const aiOptions = document.getElementById('aiOptions');
const aiProviderSelect = document.getElementById('aiProvider');
const apiKeyInput = document.getElementById('apiKey');
const saveSettingsBtn = document.getElementById('saveSettings');

// Load saved settings on open
api.storage.local.get(['aiEnabled', 'aiProvider', 'apiKey'], (data) => {
  aiToggle.checked = !!data.aiEnabled;
  aiProviderSelect.value = data.aiProvider || 'claude';
  apiKeyInput.value = data.apiKey || '';
  aiOptions.classList.toggle('visible', !!data.aiEnabled);
});

settingsToggle.addEventListener('click', () => {
  settingsPanel.classList.toggle('open');
});

aiToggle.addEventListener('change', () => {
  aiOptions.classList.toggle('visible', aiToggle.checked);
});

saveSettingsBtn.addEventListener('click', () => {
  api.storage.local.set({
    aiEnabled: aiToggle.checked,
    aiProvider: aiProviderSelect.value,
    apiKey: apiKeyInput.value,
  });
  saveSettingsBtn.textContent = 'Saved ✓';
  setTimeout(() => { saveSettingsBtn.textContent = 'Save Settings'; }, 1500);
});

retrieveBtn.addEventListener('click', async () => {
  setLoading(true);
  hideResult();

  try {
    const token = await getAuthToken();
    const query = searchQueryInput.value.trim() || DEFAULT_QUERY;
    const settings = await loadSettings();

    let code = await retrieveStandard(token, query);

    if (!code && settings.aiEnabled && settings.apiKey) {
      code = await retrieveWithAI(token, query, settings);
    }

    if (code) {
      await navigator.clipboard.writeText(code);
      showSuccess(code);
    } else {
      showError('No verification code found in recent emails.');
    }
  } catch (err) {
    showError(err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
  }
});

// ── Auth ─────────────────────────────────────────────────────────────────────

function getAuthToken() {
  return isFirefox ? getAuthTokenFirefox() : getAuthTokenChrome();
}

function getAuthTokenChrome() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function getAuthTokenFirefox() {
  const redirectUrl = browser.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', GMAIL_SCOPES.join(' '));

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  const params = new URLSearchParams(new URL(responseUrl).hash.slice(1));
  const token = params.get('access_token');
  if (!token) throw new Error('Failed to get access token.');
  return token;
}

// ── Gmail API ─────────────────────────────────────────────────────────────────

async function searchMessages(token, query, maxResults) {
  const params = new URLSearchParams({ q: query, maxResults });
  const res = await fetch(`${GMAIL_API}/messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to search Gmail. Check your connection.');
  const data = await res.json();
  return data.messages || [];
}

async function fetchMessage(token, id) {
  const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch email.');
  return res.json();
}

function getSubject(message) {
  const headers = message.payload?.headers || [];
  return headers.find((h) => h.name.toLowerCase() === 'subject')?.value || '';
}

function decodeMessageBody(message) {
  const chunks = [];

  function walk(payload) {
    if (payload?.body?.data) {
      chunks.push(atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/')));
    }
    for (const part of payload?.parts || []) {
      walk(part);
    }
  }

  walk(message.payload);
  return chunks.join('\n');
}

// ── Code extraction ───────────────────────────────────────────────────────────

function extractCode(rawText) {
  // Strip HTML tags so regex works on plain content
  const text = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const patterns = [
    // Explicit label: "Your code is 123456" / "code: 123456"
    /(?:code|OTP|one.?time|passcode|pin|verification)[^a-z\d]{0,20}(\d{4,8})/i,
    // Reversed: "123456 is your verification code"
    /(\d{4,8})[^a-z\d]{0,30}(?:is your|verification|sign.?in|log.?in)/i,
    // Standalone 6-digit (most common OTP length)
    /\b(\d{6})\b/,
    // Standalone 4-digit
    /\b(\d{4})\b/,
    // Standalone 8-digit
    /\b(\d{8})\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

// ── Retrieval strategies ──────────────────────────────────────────────────────

async function retrieveStandard(token, query) {
  const messages = await searchMessages(token, query, 5);
  if (!messages.length) throw new Error('No matching emails found.');

  for (const { id } of messages) {
    const message = await fetchMessage(token, id);
    const code = extractCode(getSubject(message)) || extractCode(decodeMessageBody(message));
    if (code) return code;
  }
  return null;
}

async function retrieveWithAI(token, query, settings) {
  const messages = await searchMessages(token, query, AI_EMAIL_SCAN_COUNT);
  if (!messages.length) throw new Error('No matching emails found.');

  // Fetch subjects for all candidates in parallel
  const candidates = await Promise.all(
    messages.map(async ({ id }) => {
      const msg = await fetchMessage(token, id);
      return { id, subject: getSubject(msg) };
    })
  );

  const chosenIndex = await askAI(candidates.map((c) => c.subject), settings);

  // Fall back to standard if AI couldn't decide
  if (chosenIndex === null || !candidates[chosenIndex]) {
    return retrieveStandard(token, query);
  }

  const chosen = await fetchMessage(token, candidates[chosenIndex].id);
  return extractCode(candidates[chosenIndex].subject) || extractCode(decodeMessageBody(chosen));
}

// ── AI providers ──────────────────────────────────────────────────────────────

async function askAI(subjects, settings) {
  const numbered = subjects.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prompt = `You are helping a user find a verification code email. Here are recent email subjects:\n\n${numbered}\n\nWhich email (by number) is most likely to contain a one-time verification code or OTP? Reply with only the number, or "none" if none apply.`;

  try {
    if (settings.aiProvider === 'claude') {
      return await askClaude(prompt, settings.apiKey);
    } else {
      return await askOpenAI(prompt, settings.apiKey);
    }
  } catch {
    return null;
  }
}

async function askClaude(prompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-request-allowlist': 'allow-unsafe-user-prompts',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const index = parseInt(data.content?.[0]?.text?.trim());
  return isNaN(index) ? null : index - 1;
}

async function askOpenAI(prompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const index = parseInt(data.choices?.[0]?.message?.content?.trim());
  return isNaN(index) ? null : index - 1;
}

// ── Settings ──────────────────────────────────────────────────────────────────

function loadSettings() {
  return new Promise((resolve) => {
    api.storage.local.get(['aiEnabled', 'aiProvider', 'apiKey'], resolve);
  });
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function setLoading(loading) {
  retrieveBtn.disabled = loading;
  retrieveBtn.innerHTML = loading
    ? '<span class="spinner"></span>Searching...'
    : '🐾 Retrieve Code';
}

function showSuccess(code) {
  resultEl.className = 'result success';
  resultEl.style.display = 'block';
  codeDisplay.textContent = code;
  resultLabel.textContent = 'Copied to clipboard ✓';
}

function showError(msg) {
  resultEl.className = 'result error';
  resultEl.style.display = 'block';
  codeDisplay.textContent = '';
  resultLabel.textContent = msg;
}

function hideResult() {
  resultEl.style.display = 'none';
}
