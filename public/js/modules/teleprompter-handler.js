import { logToConsole } from './logger.js';

const TELEPROMPTER_WINDOW_NAME = 'LiveStreamTeleprompter';

// --- Globals (potentially to be managed or passed in) ---
// These were global in home.js. Consider how to manage state if these modules become more independent.
let activeTeleprompterFeedWindow = null;
let isTeleprompterFeedVisibleState = false;

// --- Helper function to set up the stream in the teleprompter window ---
function setupTeleprompterStream(win, streamToPlay) {
    logToConsole(`Teleprompter window details: URL='${win.location.href}', readyState='${win.document.readyState}'`, 'debug');
    try {
        const bodySnippet = win.document.body ? win.document.body.innerHTML.substring(0, 500) : "document.body is null";
        logToConsole(`Teleprompter window body (snippet): ${bodySnippet}`, 'debug');

        const liveFeedEl = win.document.getElementById('teleprompterLiveFeed');
        if (liveFeedEl) {
            logToConsole('Found teleprompterLiveFeed element in teleprompter window.', 'info', liveFeedEl);
            liveFeedEl.srcObject = streamToPlay;
            logToConsole('srcObject assigned to teleprompterLiveFeed element. Attempting to play after a short delay...', 'debug');

            setTimeout(() => {
                if (!win || win.closed) {
                    logToConsole('Teleprompter window closed before delayed play could execute.', 'warn');
                    return;
                }
                logToConsole('Attempting to play teleprompter live feed now...', 'info');
                liveFeedEl.currentTime = 0;
                liveFeedEl.play()
                    .then(() => {
                        logToConsole('Teleprompter live feed playing successfully (after delay).', 'success');
                        if (win && !win.closed && typeof win.showLiveVideo === 'function') {
                            win.showLiveVideo();
                        }
                        isTeleprompterFeedVisibleState = true;
                        const toggleBtn = document.getElementById('toggleTeleprompterFeedBtn');
                        if (toggleBtn) {
                            toggleBtn.textContent = 'Hide Teleprompter Live Feed';
                            toggleBtn.style.display = 'inline-block';
                        }
                    })
                    .catch(e => {
                        logToConsole(`Error playing teleprompter live feed (after delay): ${e.message}. Video muted: ${liveFeedEl.muted}`, 'error', e);
                        alert(`Could not automatically play the video feed in the teleprompter (after delay): ${e.message}.`);
                    });
            }, 100);

        } else {
            logToConsole('teleprompterLiveFeed element NOT FOUND in teleprompter window. Expected id "teleprompterLiveFeed".', 'error');
            alert('Could not find the video player element (teleprompterLiveFeed) in the teleprompter window. Check console for details.');
        }
    } catch (err) {
        logToConsole(`Error in setupTeleprompterStream: ${err.message}`, 'error', err);
        alert(`An error occurred while trying to set up the video in the teleprompter: ${err.message}`);
    }
}

// Helper function for when the teleprompter window is confirmed ready
function onTeleprompterReady(win, stream, compositor, toggleBtn) {
    logToConsole('Teleprompter window is ready. Current URL: ' + (win ? win.location.href : 'win is null/closed'), 'info');
    if (!win || win.closed) {
        logToConsole('Teleprompter window was closed before onTeleprompterReady could fully execute.', 'warn');
        if (activeTeleprompterFeedWindow === win) activeTeleprompterFeedWindow = null;
        if (toggleBtn) toggleBtn.style.display = 'none';
        localStorage.removeItem('teleprompterShouldBeStreaming');
        return;
    }
    // Check again for about:blank, as onload can sometimes fire too early or on failed navigation
    if (win.location.href === 'about:blank') {
        logToConsole('Teleprompter window onTeleprompterReady: URL is still about:blank. Aborting stream setup.', 'error');
        if (activeTeleprompterFeedWindow === win) activeTeleprompterFeedWindow = null;
        if (toggleBtn) toggleBtn.style.display = 'none';
        localStorage.removeItem('teleprompterShouldBeStreaming');
        return;
    }

    setupTeleprompterStream(win, stream);
    if (compositor && typeof compositor.isMirrored !== 'undefined') {
        updateTeleprompterMirrorState(compositor.isMirrored);
    } else {
        logToConsole('Cannot set initial teleprompter mirror state: compositor or isMirrored property unavailable.', 'warn');
    }
    localStorage.setItem('teleprompterShouldBeStreaming', 'true');
    logToConsole('Teleprompter stream successfully set up and teleprompterShouldBeStreaming flag set.', 'info');
}

// Modified function to encapsulate the streaming logic
export function openAndStreamToTeleprompter(mainOutputCanvasElement, mainRecordingCompositor, toggleTeleprompterFeedBtn, isAutoResume = false) {
    logToConsole(`Attempting to stream main output canvas to /teleprompter page... (Auto-resume: ${isAutoResume})`, 'info');

    // Enhanced check for compositor and frame source
    logToConsole(`openAndStreamToTeleprompter: Checking compositor and source. mainRecordingCompositor exists: ${!!mainRecordingCompositor}, currentFrameSource: ${mainRecordingCompositor ? mainRecordingCompositor.currentFrameSource : 'N/A'}`, 'debug');
    if (!mainRecordingCompositor || !mainRecordingCompositor.currentFrameSource) {
        alert('Please select a camera source for the main output first. The teleprompter stream cannot be started/resumed without an active video source.');
        logToConsole('Streaming to /teleprompter aborted: mainRecordingCompositor is missing or has no currentFrameSource.', 'warn');
        localStorage.removeItem('teleprompterShouldBeStreaming'); // Ensure flag is cleared
        if (toggleTeleprompterFeedBtn) { // Reset toggle button state
            toggleTeleprompterFeedBtn.style.display = 'none';
            toggleTeleprompterFeedBtn.textContent = 'Hide Teleprompter Live Feed';
        }
        // If a teleprompter window was somehow opened/acquired by this call, close it.
        if (activeTeleprompterFeedWindow && !activeTeleprompterFeedWindow.closed && activeTeleprompterFeedWindow.name === TELEPROMPTER_WINDOW_NAME) {
            // Check name to be a bit safer, ensuring we only close the one we might have just opened/re-referenced
            logToConsole('Closing teleprompter window because streaming cannot proceed due to missing source.', 'warn');
            activeTeleprompterFeedWindow.close();
            activeTeleprompterFeedWindow = null;
        }
        return;
    }

    if (!mainOutputCanvasElement) {
        alert('Main output canvas element is not available for streaming.');
        logToConsole('Streaming to /teleprompter aborted: mainOutputCanvasElement is null.', 'warn');
        return;
    }

    try {
        if (activeTeleprompterFeedWindow && !activeTeleprompterFeedWindow.closed) {
            logToConsole('An active teleprompter feed window from this session exists. Closing it before opening a new one.', 'info');
            activeTeleprompterFeedWindow.close(); // Close window controlled by this session
            activeTeleprompterFeedWindow = null; // Clear our reference
        }

        // Use fixed window name
        const teleprompterWin = window.open('/teleprompter', TELEPROMPTER_WINDOW_NAME, 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
        activeTeleprompterFeedWindow = teleprompterWin; // Track the window opened/re-focused by this session
        isTeleprompterFeedVisibleState = false;
        if (toggleTeleprompterFeedBtn) toggleTeleprompterFeedBtn.style.display = 'none';

        if (!teleprompterWin) {
            alert('Failed to open teleprompter window. Please check popup blocker settings.');
            logToConsole('Failed to open /teleprompter window.', 'error');
            return;
        }

        const setupStreamAndWindow = () => {
            const stream = mainOutputCanvasElement.captureStream(25);
            logToConsole('Captured stream from mainOutputCanvasElement for /teleprompter.', 'debug', stream);

            teleprompterWin.onerror = (eventOrMessage, source, lineno, colno, error) => {
                const errorMessage = error ? error.message : eventOrMessage;
                logToConsole(`Teleprompter window onerror: ${errorMessage}`, 'error', { eventOrMessage, source, lineno, colno, error });
                alert('The teleprompter window encountered an error while loading its content. Check its console.');
                localStorage.removeItem('teleprompterShouldBeStreaming'); // Clear flag on error
                if (activeTeleprompterFeedWindow === teleprompterWin) {
                    activeTeleprompterFeedWindow = null;
                }
                if (toggleTeleprompterFeedBtn) toggleTeleprompterFeedBtn.style.display = 'none';
            };

            logToConsole(`Checking teleprompter window state. Current readyState: ${teleprompterWin.document.readyState}, location: ${teleprompterWin.location.href}`, 'debug');
            if (teleprompterWin.document.readyState === 'complete' && teleprompterWin.location.href !== 'about:blank' && teleprompterWin.location.pathname === '/teleprompter') {
                logToConsole('Teleprompter window already loaded and seems valid. Proceeding with stream setup immediately.', 'info');
                onTeleprompterReady(teleprompterWin, stream, mainRecordingCompositor, toggleTeleprompterFeedBtn);
            } else {
                logToConsole('Teleprompter window not yet fully loaded or is about:blank/incorrect. Setting up onload listener.', 'debug');
                teleprompterWin.onload = () => {
                    onTeleprompterReady(teleprompterWin, stream, mainRecordingCompositor, toggleTeleprompterFeedBtn);
                };
            }
        };

        if (isAutoResume) {
            logToConsole('Auto-resume: Delaying stream capture slightly to allow first frame rendering.', 'info');
            setTimeout(setupStreamAndWindow, 250); // 250ms delay, adjust if needed
        } else {
            setupStreamAndWindow(); // No delay for manual clicks
        }

        const teleprompterWinClosedCheckInterval = setInterval(() => {
            if (activeTeleprompterFeedWindow && activeTeleprompterFeedWindow.closed) {
                logToConsole('Live feed teleprompter window was closed by user (detected by interval check).', 'info');
                activeTeleprompterFeedWindow = null;
                isTeleprompterFeedVisibleState = false;
                if (toggleTeleprompterFeedBtn) {
                    toggleTeleprompterFeedBtn.style.display = 'none';
                    toggleTeleprompterFeedBtn.textContent = 'Hide Teleprompter Live Feed';
                }
                localStorage.removeItem('teleprompterShouldBeStreaming'); // Clear flag
                clearInterval(teleprompterWinClosedCheckInterval);
            }
        }, 1000);

    } catch (error) {
        logToConsole(`Error initiating stream to /teleprompter: ${error.message}`, 'error', error);
        alert(`Error setting up /teleprompter stream: ${error.message}`);
    }
}

// --- Initialize Teleprompter Streaming Logic ---
export function initializeTeleprompterStreaming(mainOutputCanvasElement, mainRecordingCompositor) {
    // const streamMainOutputToTeleprompterBtn = document.getElementById('streamMainOutputToTeleprompterBtn'); // Removed
    const toggleTeleprompterFeedBtn = document.getElementById('toggleTeleprompterFeedBtn');

    // The following block related to streamMainOutputToTeleprompterBtn is removed as the button is gone.
    // if (streamMainOutputToTeleprompterBtn && mainOutputCanvasElement && mainRecordingCompositor) {
    //     streamMainOutputToTeleprompterBtn.addEventListener('click', () => {
    //         openAndStreamToTeleprompter(mainOutputCanvasElement, mainRecordingCompositor, toggleTeleprompterFeedBtn, false);
    //     });
    // } else {
    //     // Warnings related to streamMainOutputToTeleprompterBtn can be removed or adapted if necessary
    //     // if (!streamMainOutputToTeleprompterBtn) logToConsole('streamMainOutputToTeleprompterBtn not found.', 'warn'); // Button removed
    //     if (!mainOutputCanvasElement) logToConsole('mainOutputCanvasElement not found (for teleprompter streaming init).', 'warn');
    //     if (!mainRecordingCompositor) logToConsole('mainRecordingCompositor not found (for teleprompter streaming init).', 'warn');
    // }

    // Keep the logic for toggleTeleprompterFeedBtn
    if (toggleTeleprompterFeedBtn) {
        toggleTeleprompterFeedBtn.addEventListener('click', () => {
            if (activeTeleprompterFeedWindow && !activeTeleprompterFeedWindow.closed) {
                if (isTeleprompterFeedVisibleState) {
                    if (typeof activeTeleprompterFeedWindow.hideLiveVideo === 'function') {
                        activeTeleprompterFeedWindow.hideLiveVideo();
                        toggleTeleprompterFeedBtn.textContent = 'Show Teleprompter Live Feed';
                        isTeleprompterFeedVisibleState = false;
                        logToConsole('User toggled live feed OFF.', 'info');
                    }
                } else {
                    if (typeof activeTeleprompterFeedWindow.showLiveVideo === 'function') {
                        activeTeleprompterFeedWindow.showLiveVideo();
                        toggleTeleprompterFeedBtn.textContent = 'Hide Teleprompter Live Feed';
                        isTeleprompterFeedVisibleState = true;
                        logToConsole('User toggled live feed ON.', 'info');
                    }
                }
            } else {
                logToConsole('Toggle button clicked but no active/open teleprompter feed window.', 'warn');
                toggleTeleprompterFeedBtn.style.display = 'none'; // Hide if no window
            }
        });
    } else {
        logToConsole('toggleTeleprompterFeedBtn not found during initialization.', 'warn');
    }
}

export function updateTeleprompterMirrorState(isMirrored) {
    if (activeTeleprompterFeedWindow && !activeTeleprompterFeedWindow.closed) {
        if (typeof activeTeleprompterFeedWindow.setLiveFeedMirror === 'function') {
            activeTeleprompterFeedWindow.setLiveFeedMirror(isMirrored);
            logToConsole(`Called setLiveFeedMirror(${isMirrored}) on teleprompter window.`, 'info');
        } else {
            logToConsole('setLiveFeedMirror function not found in teleprompter window.', 'warn');
        }
    } else {
        logToConsole('UpdateTeleprompterMirrorState: No active teleprompter window or it is closed.', 'debug');
    }
}