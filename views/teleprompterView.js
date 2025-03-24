/*******************************************************
 * teleprompterView.js
 *   - Returns the HTML for the teleprompter page
 *******************************************************/
module.exports = function buildTeleprompterHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>AI Director Teleprompter</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #000;
      color: #fff;
      font-family: monospace;
      overflow: hidden;
    }
    #teleprompter {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      padding: 1.25rem;
      box-sizing: border-box;
      font-size: 3rem;
      line-height: 1.4;
      white-space: pre-wrap;
      word-wrap: break-word;
      transition: opacity 0.3s ease;
      overflow-y: auto;
    }
    #video-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000;
      z-index: 1000;
      display: none;
    }
    #video-container.active {
      display: block;
    }
    #video-container video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    #teleprompter.fade {
      opacity: 0.5;
    }
    .message {
      max-width: 90%;
      margin: 1.25rem auto;
      padding: 1.25rem;
      border-radius: 0.5rem;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(5px);
      transform: translateY(0);
      opacity: 1;
      transition: all 0.5s ease;
      display: flex;
      align-items: center;
      gap: 1.25rem;
      width: 100%;
      box-sizing: border-box;
    }
    .message.new {
      transform: translateY(-20px);
      opacity: 0;
    }
    .message.old {
      transform: translateY(20px);
      opacity: 0;
    }
    .message-content {
      flex: 1;
      font-size: 1rem;
      min-width: 0;
    }
    .message-image {
      width: 25%;
      max-width: 12.5rem;
      height: auto;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 0.25rem;
      flex-shrink: 0;
    }
    .message.actor {
      background: rgba(0, 255, 0, 0.1);
    }
    .message.direction {
      background: rgba(255, 255, 0, 0.1);
    }
    .message.action {
      background: rgba(255, 0, 0, 0.1);
    }
    .message.normal {
      background: rgba(255, 255, 255, 0.1);
    }
  </style>
</head>
<body>
  <div id="video-container">
    <video id="teleprompter-video" autoplay playsinline></video>
  </div>
  <div id="teleprompter"></div>

  <script>
    let ws;
    const teleprompter = document.getElementById('teleprompter');
    const videoContainer = document.getElementById('video-container');
    const videoElement = document.getElementById('teleprompter-video');
    let isFaded = false;

    function addMessage(text, style, image) {
      const message = document.createElement('div');
      message.className = 'message ' + style;
      
      const content = document.createElement('div');
      content.className = 'message-content';
      
      // If the text starts with a character name (e.g., "Dr. Alan Grant: *action*")
      if (text.includes(':')) {
        const [character, action] = text.split(':').map(s => s.trim());
        content.innerHTML = "<strong>" + character + ":</strong> " + action;
      } else {
        content.textContent = text;
      }
      
      message.appendChild(content);
      
      if (image) {
        const img = document.createElement('img');
        img.className = 'message-image';
        img.src = image;
        message.appendChild(img);
      }
      
      // Add to the beginning of the list
      if (teleprompter.firstChild) {
        teleprompter.insertBefore(message, teleprompter.firstChild);
      } else {
        teleprompter.appendChild(message);
      }
      
      // Trigger animation
      requestAnimationFrame(() => {
        message.classList.add('new');
        setTimeout(() => {
          message.classList.remove('new');
        }, 50);
      });
      
      // Remove old messages if we have too many
      const maxMessages = 10;
      while (teleprompter.children.length > maxMessages) {
        const lastMessage = teleprompter.lastChild;
        lastMessage.classList.add('old');
        setTimeout(() => {
          lastMessage.remove();
        }, 500);
      }
    }

    function clearText() {
      const messages = teleprompter.children;
      for (let i = 0; i < messages.length; i++) {
        messages[i].classList.add('old');
      }
      setTimeout(() => {
        teleprompter.innerHTML = '';
      }, 500);
    }

    function playVideo(videoPath) {
      videoElement.src = videoPath;
      videoContainer.classList.add('active');
      
      videoElement.onended = () => {
        videoContainer.classList.remove('active');
      };
    }

    function handleWebSocketMessage(event) {
      const data = JSON.parse(event.data);
      console.log('Teleprompter received:', data);
      if (data.type === 'TELEPROMPTER') {
        console.log('Adding teleprompter message:', data.text);
        addMessage(data.text, data.style || 'normal', data.image);
      } else if (data.type === 'SCENE_EVENT') {
        console.log('Adding scene event:', data.event);
        // Format the message with character name and style
       const message = data.event.character + ": " + data.event.text;
        addMessage(message, data.event.style || 'normal');
      } else if (data.type === 'CLEAR_TELEPROMPTER') {
        clearText();
      } else if (data.type === 'PLAY_VIDEO') {
        playVideo(data.videoPath);
      }
    }

    function connectWebSocket() {
      ws = new WebSocket('ws://' + window.location.host);
      
      ws.onopen = function() {
        console.log('Teleprompter WebSocket connected');
      };

      ws.onmessage = handleWebSocketMessage;

      ws.onerror = function(error) {
        console.error('Teleprompter WebSocket error:', error);
        // Try to reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
      };

      ws.onclose = function() {
        console.log('Teleprompter WebSocket closed');
        // Try to reconnect after 5 seconds
        setTimeout(connectWebSocket, 5000);
      };
    }

    // Initial connection
    connectWebSocket();

    function toggleFade() {
      isFaded = !isFaded;
      teleprompter.classList.toggle('fade', isFaded);
    }
  </script>
</body>
</html>
`;
}; 