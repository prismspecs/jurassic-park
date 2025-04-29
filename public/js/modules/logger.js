/**
 * Logs a message to the console output element in the DOM.
 * @param {string} message - The message to log.
 * @param {string} [level='info'] - The log level ('info', 'warn', 'error', 'success').
 */
export function logToConsole(message, level = 'info') {
    const consoleOutput = document.getElementById("console-output");
    const entry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    entry.className = `log-entry log-${level}`;
    entry.innerHTML = `<span class="timestamp">[${timestamp}]</span> ${message}`;
    if (consoleOutput) {
      consoleOutput.appendChild(entry);
      // Scroll to the bottom only if the user isn't scrolled up
      // Add a small threshold to account for slight scrolling
      const scrollThreshold = 5; 
      if (consoleOutput.scrollHeight - consoleOutput.scrollTop - consoleOutput.clientHeight < scrollThreshold) {
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
      }
    } else {
      // Fallback to browser console if DOM element is missing
      console.error(`Console output element (#console-output) not found! Message: ${message}`);
    }
} 