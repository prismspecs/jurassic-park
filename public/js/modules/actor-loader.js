export function initializeActorLoader() {
    const loadActorsBtn = document.getElementById('loadActorsBtn');
    const refreshActorsBtn = document.getElementById('refreshActorsBtn');
    const actorFilesInput = document.getElementById('actorFiles');
    const loadActorsStatus = document.getElementById('loadActorsStatus');

    if (loadActorsBtn && actorFilesInput && loadActorsStatus) {
        loadActorsBtn.addEventListener('click', async () => {
            const files = actorFilesInput.files;
            if (!files || files.length === 0) {
                loadActorsStatus.textContent = 'Please select files to load.';
                loadActorsStatus.style.color = 'orange';
                return;
            }
            const formData = new FormData();
            for (const file of files) { formData.append('files', file); }
            loadActorsStatus.textContent = 'Loading...';
            loadActorsStatus.style.color = '#aaa';
            try {
                const response = await fetch('/loadActors', { method: 'POST', body: formData });
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || `HTTP error ${response.status}`);
                }
                loadActorsStatus.textContent = result.message || 'Actors loaded!';
                loadActorsStatus.style.color = 'green';
                actorFilesInput.value = ''; // Clear the input after successful load
            } catch (error) {
                console.error("Actor Load Error:", error);
                loadActorsStatus.textContent = `Error: ${error.message}`;
                loadActorsStatus.style.color = 'red';
            }
        });
    } else {
        if (!loadActorsBtn) console.warn('loadActorsBtn not found for actor loader.');
        if (!actorFilesInput) console.warn('actorFilesInput not found for actor loader.');
        if (!loadActorsStatus) console.warn('loadActorsStatus not found for actor loader.');
    }

    // Add functionality for the Refresh Actors button
    if (refreshActorsBtn && loadActorsStatus) {
        refreshActorsBtn.addEventListener('click', async () => {
            loadActorsStatus.textContent = 'Refreshing...';
            loadActorsStatus.style.color = '#aaa';
            try {
                const response = await fetch('/api/actors/refresh');
                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.message || `HTTP error ${response.status}`);
                }
                if (result.success) {
                    let statusMessage = result.message;
                    if (result.added?.length > 0 || result.removed?.length > 0) {
                        statusMessage += '\n';
                        if (result.added?.length > 0) {
                            statusMessage += `Added: ${result.added.join(', ')}\n`;
                        }
                        if (result.removed?.length > 0) {
                            statusMessage += `Removed: ${result.removed.join(', ')}\n`;
                        }
                    }
                    loadActorsStatus.textContent = statusMessage.trim();
                    loadActorsStatus.style.whiteSpace = 'pre-line';
                    loadActorsStatus.style.color = 'green';
                } else {
                    loadActorsStatus.textContent = result.message || 'Failed to refresh actors';
                    loadActorsStatus.style.color = 'orange';
                }
            } catch (error) {
                console.error("Actor Refresh Error:", error);
                loadActorsStatus.textContent = `Error: ${error.message}`;
                loadActorsStatus.style.color = 'red';
            }
        });
    } else {
        if (!refreshActorsBtn) console.warn('refreshActorsBtn not found for actor loader.');
    }
} 