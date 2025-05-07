export function initializeActorLoader() {
    const loadActorsBtn = document.getElementById('loadActorsBtn');
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
} 