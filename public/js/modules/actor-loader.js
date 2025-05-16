export function initializeActorLoader() {
    const loadActorsBtn = document.getElementById('loadActorsBtn');
    const refreshActorsBtn = document.getElementById('refreshActorsBtn');
    const showActorsBtn = document.getElementById('showActorsBtn');
    const actorFilesInput = document.getElementById('actorFiles');
    const loadActorsStatus = document.getElementById('loadActorsStatus');

    // Modal elements
    const actorsModal = document.getElementById('actorsModal');
    const closeActorsModalBtn = document.getElementById('closeActorsModal');
    const actorsPreviewArea = document.getElementById('actorsPreviewArea');

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

    // Functionality for Show Actors button
    if (showActorsBtn && actorsModal && closeActorsModalBtn && actorsPreviewArea) {
        showActorsBtn.addEventListener('click', async () => {
            loadActorsStatus.textContent = 'Fetching actors...';
            loadActorsStatus.style.color = '#aaa';
            try {
                const response = await fetch('/api/actors');
                const result = await response.json();

                if (!response.ok || !result.success) {
                    throw new Error(result.message || `HTTP error ${response.status}`);
                }

                actorsPreviewArea.innerHTML = ''; // Clear previous actors

                if (result.actors && result.actors.length > 0) {
                    result.actors.forEach(actor => {
                        const actorCard = document.createElement('div');
                        actorCard.className = 'actor-card-preview';
                        actorCard.dataset.actorId = actor.id; // Store ID on the card for easy access

                        const img = document.createElement('img');
                        img.src = actor.headshotUrl || 'https://via.placeholder.com/100x100.png?text=No+Image'; // Placeholder if no image
                        img.alt = actor.name;
                        img.style.width = '100px';
                        img.style.height = '100px';
                        img.style.objectFit = 'cover';
                        img.onerror = () => {
                            img.src = 'https://via.placeholder.com/100x100.png?text=Error';
                            img.alt = 'Error loading image';
                        };

                        const name = document.createElement('p');
                        name.textContent = actor.name;

                        const removeBtn = document.createElement('button');
                        removeBtn.className = 'remove-actor-btn';
                        removeBtn.textContent = 'Remove';
                        removeBtn.dataset.actorId = actor.id;
                        removeBtn.dataset.actorName = actor.name; // For confirmation message

                        actorCard.appendChild(img);
                        actorCard.appendChild(name);
                        actorCard.appendChild(removeBtn);
                        actorsPreviewArea.appendChild(actorCard);
                    });
                    loadActorsStatus.textContent = 'Actors loaded in preview.';
                    loadActorsStatus.style.color = 'green';
                } else {
                    actorsPreviewArea.innerHTML = '<p>No actors found.</p>';
                    loadActorsStatus.textContent = 'No actors to display.';
                    loadActorsStatus.style.color = 'orange';
                }
                actorsModal.style.display = 'block';
            } catch (error) {
                console.error("Show Actors Error:", error);
                loadActorsStatus.textContent = `Error: ${error.message}`;
                loadActorsStatus.style.color = 'red';
                actorsPreviewArea.innerHTML = '<p>Error loading actors.</p>';
                actorsModal.style.display = 'block'; // Show modal even on error to display the error message
            }
        });

        // Event delegation for remove buttons
        actorsPreviewArea.addEventListener('click', async (event) => {
            if (event.target.classList.contains('remove-actor-btn')) {
                const actorId = event.target.dataset.actorId;
                const actorName = event.target.dataset.actorName;

                if (!actorId) return;

                if (window.confirm(`Are you sure you want to remove ${actorName} and all their files? This action cannot be undone.`)) {
                    loadActorsStatus.textContent = `Removing ${actorName}...`;
                    loadActorsStatus.style.color = '#aaa';
                    try {
                        const response = await fetch(`/api/actors/${actorId}`, { method: 'DELETE' });
                        const result = await response.json();

                        if (!response.ok || !result.success) {
                            throw new Error(result.message || `HTTP error ${response.status}`);
                        }

                        // Remove the card from the DOM
                        const cardToRemove = document.querySelector(`.actor-card-preview[data-actor-id="${actorId}"]`);
                        if (cardToRemove) {
                            cardToRemove.remove();
                        }
                        loadActorsStatus.textContent = result.message || `${actorName} removed successfully.`;
                        loadActorsStatus.style.color = 'green';

                        // Optionally, refresh the main actor list if another part of the UI displays it
                        // or if the number of actors changes, update a counter etc.

                    } catch (error) {
                        console.error("Remove Actor Error:", error);
                        loadActorsStatus.textContent = `Error removing ${actorName}: ${error.message}`;
                        loadActorsStatus.style.color = 'red';
                    }
                }
            }
        });

        closeActorsModalBtn.addEventListener('click', () => {
            actorsModal.style.display = 'none';
        });

        // Close modal if clicked outside of modal-content
        window.addEventListener('click', (event) => {
            if (event.target === actorsModal) {
                actorsModal.style.display = 'none';
            }
        });
    } else {
        if (!showActorsBtn) console.warn('showActorsBtn not found.');
        if (!actorsModal) console.warn('actorsModal not found.');
        if (!closeActorsModalBtn) console.warn('closeActorsModalBtn not found.');
        if (!actorsPreviewArea) console.warn('actorsPreviewArea not found.');
    }
} 