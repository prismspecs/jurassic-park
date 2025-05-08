import { logToConsole } from './logger.js';

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

// --- Initialize Teleprompter Streaming Logic ---
// mainOutputCanvasElement and mainRecordingCompositor will need to be passed or accessed
export function initializeTeleprompterStreaming(mainOutputCanvasElement, mainRecordingCompositor) {
    const streamMainOutputToTeleprompterBtn = document.getElementById('streamMainOutputToTeleprompterBtn');
    const toggleTeleprompterFeedBtn = document.getElementById('toggleTeleprompterFeedBtn');

    if (streamMainOutputToTeleprompterBtn && mainOutputCanvasElement && mainRecordingCompositor) {
        streamMainOutputToTeleprompterBtn.addEventListener('click', () => {
            logToConsole('Attempting to stream main output canvas to /teleprompter page...', 'info');
            if (!mainRecordingCompositor.currentFrameSource) {
                alert('Please select a camera source for the main output first.');
                logToConsole('Streaming to /teleprompter aborted: No source for mainRecordingCompositor.', 'warn');
                return;
            }

            try {
                if (activeTeleprompterFeedWindow && !activeTeleprompterFeedWindow.closed) {
                    activeTeleprompterFeedWindow.close();
                    logToConsole('Closed previous live feed teleprompter window.', 'info');
                }

                const teleprompterWin = window.open('/teleprompter', 'LiveStreamTeleprompter_' + Date.now(), 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
                activeTeleprompterFeedWindow = teleprompterWin;
                isTeleprompterFeedVisibleState = false;
                if (toggleTeleprompterFeedBtn) toggleTeleprompterFeedBtn.style.display = 'none';

                if (!teleprompterWin) {
                    alert('Failed to open teleprompter window. Please check popup blocker settings.');
                    logToConsole('Failed to open /teleprompter window.', 'error');
                    return;
                }

                const stream = mainOutputCanvasElement.captureStream(25);
                logToConsole('Captured stream from mainOutputCanvasElement for /teleprompter.', 'debug', stream);

                teleprompterWin.onerror = (eventOrMessage, source, lineno, colno, error) => {
                    const errorMessage = error ? error.message : eventOrMessage;
                    logToConsole(`Teleprompter window onerror: ${errorMessage}`, 'error', { eventOrMessage, source, lineno, colno, error });
                    alert('The teleprompter window encountered an error while loading its content. Check its console.');
                };

                logToConsole('Setting up onload listener for /teleprompter window.', 'debug');
                teleprompterWin.onload = () => {
                    logToConsole('Teleprompter (/teleprompter) window ONLOAD event fired. Current URL: ' + (teleprompterWin ? teleprompterWin.location.href : 'teleprompterWin is null/closed'), 'info');
                    if (!teleprompterWin || teleprompterWin.closed) {
                        logToConsole('Teleprompter (/teleprompter) window was closed before onload handler could fully execute.', 'warn');
                        activeTeleprompterFeedWindow = null;
                        if (toggleTeleprompterFeedBtn) toggleTeleprompterFeedBtn.style.display = 'none';
                        return;
                    }
                    if (teleprompterWin.location.href === 'about:blank') {
                        logToConsole('Teleprompter (/teleprompter) window onload fired but URL is still about:blank.', 'error');
                        activeTeleprompterFeedWindow = null;
                        if (toggleTeleprompterFeedBtn) toggleTeleprompterFeedBtn.style.display = 'none';
                        return;
                    }
                    setupTeleprompterStream(teleprompterWin, stream);
                    // Set initial mirror state
                    if (mainRecordingCompositor && typeof mainRecordingCompositor.isMirrored !== 'undefined') {
                        updateTeleprompterMirrorState(mainRecordingCompositor.isMirrored);
                    } else {
                        logToConsole('Cannot set initial teleprompter mirror state: mainRecordingCompositor or isMirrored property unavailable.', 'warn');
                    }
                };

                const teleprompterWinClosedCheckInterval = setInterval(() => {
                    if (activeTeleprompterFeedWindow && activeTeleprompterFeedWindow.closed) {
                        logToConsole('Live feed teleprompter window was closed by user.', 'info');
                        activeTeleprompterFeedWindow = null;
                        isTeleprompterFeedVisibleState = false;
                        if (toggleTeleprompterFeedBtn) {
                            toggleTeleprompterFeedBtn.style.display = 'none';
                            toggleTeleprompterFeedBtn.textContent = 'Hide Teleprompter Live Feed';
                        }
                        clearInterval(teleprompterWinClosedCheckInterval);
                    }
                }, 1000);

            } catch (error) {
                logToConsole(`Error initiating stream to /teleprompter: ${error.message}`, 'error', error);
                alert(`Error setting up /teleprompter stream: ${error.message}`);
            }
        });
    } else {
        if (!streamMainOutputToTeleprompterBtn) logToConsole('streamMainOutputToTeleprompterBtn not found.', 'warn');
        if (!mainOutputCanvasElement) logToConsole('mainOutputCanvasElement not found (for teleprompter streaming).', 'warn');
        if (!mainRecordingCompositor) logToConsole('mainRecordingCompositor not found (for teleprompter streaming).', 'warn');
    }

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
                toggleTeleprompterFeedBtn.style.display = 'none';
            }
        });
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