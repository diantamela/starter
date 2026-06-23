const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');
const messageHistory = [];

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  // 1. Tampilkan pesan user ke chat box
  appendMessage('user', userMessage);
  messageHistory.push({ role: 'user', text: userMessage });

  // 2. Kosongkan input
  input.value = '';

  // 3. Tampilkan pesan "Thinking..." sementara
  const thinkingEl = appendMessage('bot', 'Thinking...');

  // 4. Nonaktifkan tombol submit selama request
  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  try {
    // 5. KIRIM FETCH KE BACKEND DI SINI
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: messageHistory })
    });

    // 6. Cek apakah response sukses (status 200)
    if (!response.ok) {
      throw new Error(`Server responded with status ${response.status}`);
    }

    // 7. Parse JSON response
    const data = await response.json();

    // 8. Ambil teks reply dari properti "result"
    //    Backend returns: { result: "..." }
    const reply = data?.result;

    if (reply) {
      // Ganti "Thinking..." dengan reply asli
      thinkingEl.textContent = reply;
      messageHistory.push({ role: 'model', text: reply });
    } else {
      thinkingEl.textContent = 'Sorry, no response received.';
    }
  } catch (err) {
    console.error('Chat request failed:', err);
    thinkingEl.textContent = 'Failed to get response from server.';
  } finally {
    submitBtn.disabled = false;
    input.focus();
  }
});

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.classList.add('message', sender);
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
}