let consoleOutputDisplay = null; // Cache the element
let messageQueue = []; // Queue for early messages

function flushMessageQueue() {
  // Ensure the console display is found before flushing
  if (!consoleOutputDisplay) {
    consoleOutputDisplay = document.getElementById("console-output"); // CORRECT ID
  }

  if (consoleOutputDisplay && messageQueue.length > 0) {
    console.log("[Logger] Flushing message queue..."); // Add log
    messageQueue.forEach(item => {
      const entry = document.createElement('div');
      entry.className = `log-entry log-${item.level.toLowerCase()}`;
      entry.innerHTML = `<span class="timestamp">[${item.timestamp}]</span> `;

      const textNode = document.createTextNode(item.message);
      const messageSpan = document.createElement('span');
      messageSpan.className = 'log-message-text';
      messageSpan.appendChild(textNode);
      entry.appendChild(messageSpan);

      consoleOutputDisplay.appendChild(entry);
    });
    messageQueue = []; // Clear the queue
    consoleOutputDisplay.scrollTop = consoleOutputDisplay.scrollHeight; // Scroll after flushing
  } else if (!consoleOutputDisplay) {
    // console.warn("[Logger] Tried to flush queue, but console display not found yet."); // Avoid repetitive warnings
  }
}

// Set up the listener to find the console and flush the queue once the DOM is fully parsed.
document.addEventListener('DOMContentLoaded', () => {
  consoleOutputDisplay = document.getElementById("console-output"); // CORRECT ID
  if (consoleOutputDisplay) {
    console.log("[Logger] DOMContentLoaded: Console display found. Flushing queue if needed.");
    flushMessageQueue();
  } else {
    // This error indicates the element is missing from the HTML structure entirely.
    console.error("[Logger] DOMContentLoaded: HTML console (#console-output) STILL not found! Check home.ejs.");
  }
});

/**
 * Logs a message to the HTML console display and the browser's console.
 * @param {string} message - The message to log.
 * @param {string} [level='info'] - The log level ('info', 'warn', 'error', 'success', 'debug').
 * @param {any} [data=null] - Optional additional data to log to the browser console.
 */
export function logToConsole(message, level = 'info', data = null) {
  const timestamp = new Date().toLocaleTimeString();

  // Attempt to get the console display element ONLY if not already found by DOMContentLoaded.
  // This acts as a fallback for calls happening *very* close to DOM load but maybe before the listener fired.
  if (!consoleOutputDisplay) {
    consoleOutputDisplay = document.getElementById("console-output"); // CORRECT ID
  }

  if (consoleOutputDisplay) {
    // If we just found the element here AND the queue has items, flush.
    // This handles the rare case logToConsole runs after DOMContentLoaded but before the listener callback completed.
    if (messageQueue.length > 0) {
      flushMessageQueue();
    }

    // Append the CURRENT message directly
    const entry = document.createElement('div');
    entry.className = `log-entry log-${level.toLowerCase()}`;
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> `;

    const textNode = document.createTextNode(message);
    const messageSpan = document.createElement('span');
    messageSpan.className = 'log-message-text';
    messageSpan.appendChild(textNode);
    entry.appendChild(messageSpan);

    consoleOutputDisplay.appendChild(entry);
    consoleOutputDisplay.scrollTop = consoleOutputDisplay.scrollHeight;
  } else {
    // Element not found yet, queue the message
    messageQueue.push({ message, level, timestamp });
  }

  // Log to browser's native console (always works)
  const browserLogMessage = `[UI Console][${timestamp}] ${message}`;
  switch (level.toLowerCase()) {
    case 'error':
      data ? console.error(browserLogMessage, data) : console.error(browserLogMessage);
      break;
    case 'warn':
      data ? console.warn(browserLogMessage, data) : console.warn(browserLogMessage);
      break;
    case 'success':
      data ? console.info(`%c${browserLogMessage}`, 'color: #28a745; font-weight: bold;', data) : console.info(`%c${browserLogMessage}`, 'color: #28a745; font-weight: bold;');
      break;
    case 'debug':
      data ? console.debug(browserLogMessage, data) : console.debug(browserLogMessage);
      break;
    case 'info':
    default:
      data ? console.info(browserLogMessage, data) : console.info(browserLogMessage);
      break;
  }
} 