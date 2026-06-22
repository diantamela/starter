const form = document.getElementById('chat-form');
const input = document.getElementById('user-input');
const chatBox = document.getElementById('chat-box');

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const userMessage = input.value.trim();
  if (!userMessage) return;

  appendMessage('user', userMessage);
  input.value = '';

  const loadingMessage = appendMessage('bot', 'Gemini sedang berpikir...');

  try {
    const response = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Terjadi kesalahan saat memanggil server.');
    }

    loadingMessage.textContent = data.reply || 'Gemini tidak memberikan jawaban.';
  } catch (error) {
    loadingMessage.textContent = `Error: ${error.message}`;
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
