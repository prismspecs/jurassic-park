import { logToConsole } from './logger.js';

export class AudioManager {
    constructor() {
        this.container = document.getElementById('audioDeviceControls');
        this.availableDevices = []; // Fetched from /api/audio/devices
        this.selectedDevices = {}; // Store selected devices: { cardId: { deviceId: '', name: '' } }
        this.deviceCardCounter = 0;

        if (!this.container) {
            logToConsole('Audio device controls container #audioDeviceControls not found.', 'error');
        }
    }

    async initialize() {
        logToConsole('Initializing AudioManager...', 'info');
        if (!this.container) return; // Don't proceed if container missing
        await this.fetchAvailableDevices();
        // Optionally, fetch currently active devices if needed to pre-populate cards?
        // For now, assume we start fresh or the backend handles persistence.
        logToConsole('AudioManager initialized.', 'info');
    }

    async fetchAvailableDevices() {
        logToConsole('Fetching available audio devices...', 'info');
        try {
            const response = await fetch('/api/audio/devices');
            if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
            }
            this.availableDevices = await response.json();
            logToConsole(`Found ${this.availableDevices.length} available audio devices.`, 'info');
            // Update dropdowns in existing cards if any devices changed
            this.updateAllDropdowns();
        } catch (error) {
            logToConsole(`Error fetching available audio devices: ${error.message}`, 'error');
            this.availableDevices = []; // Reset on error
        }
    }

    addDeviceCard() {
        if (!this.container) return;

        this.deviceCardCounter++;
        const cardId = `audio-card-${this.deviceCardCounter}`;
        const cardDiv = document.createElement('div');
        cardDiv.classList.add('audio-device-card', 'device-card'); // Add generic class?
        cardDiv.id = cardId;

        // Dropdown
        const select = document.createElement('select');
        select.id = `select-${cardId}`;
        select.innerHTML = '<option value="">-- Select Audio Device --</option>';
        this.populateDropdown(select);
        select.addEventListener('change', (event) => this.handleSelectionChange(event, cardId));

        // Test Button
        const testBtn = document.createElement('button');
        testBtn.id = `test-${cardId}`;
        testBtn.textContent = 'Test';
        testBtn.disabled = true;
        testBtn.addEventListener('click', () => this.handleTestClick(cardId));

        // Remove Button
        const removeBtn = document.createElement('button');
        removeBtn.textContent = 'Remove';
        removeBtn.classList.add('remove-btn');
        removeBtn.addEventListener('click', () => this.handleRemoveClick(cardId));

        // Status Span
        const statusSpan = document.createElement('span');
        statusSpan.id = `status-${cardId}`;
        statusSpan.classList.add('status-indicator');

        cardDiv.appendChild(select);
        cardDiv.appendChild(testBtn);
        cardDiv.appendChild(statusSpan);
        cardDiv.appendChild(removeBtn);
        this.container.appendChild(cardDiv);

        // Initialize state for this card
        this.selectedDevices[cardId] = { deviceId: '', name: '' };
    }

    populateDropdown(selectElement) {
        const currentCardId = selectElement.id.replace('select-', '');
        const currentlySelectedInThisDropdown = this.selectedDevices[currentCardId]?.deviceId || '';
        const selectedIdsInOtherCards = Object.entries(this.selectedDevices)
            .filter(([id, data]) => id !== currentCardId && data.deviceId)
            .map(([id, data]) => data.deviceId);

        // Filter available devices
        const options = this.availableDevices.filter(device =>
            !selectedIdsInOtherCards.includes(device.id)
        );

        // Clear existing options except the placeholder
        selectElement.innerHTML = '<option value="">-- Select Audio Device --</option>';

        options.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;
            option.textContent = device.name;
            selectElement.appendChild(option);
        });

        // Restore selection if it's still valid
        if (options.some(d => d.id === currentlySelectedInThisDropdown)) {
            selectElement.value = currentlySelectedInThisDropdown;
        } else {
            // If previous selection is now invalid (taken by another card), reset
            selectElement.value = "";
            this.selectedDevices[currentCardId] = { deviceId: '', name: '' }; // Reset state
            // Potentially call deactivate API if a device was actively selected before becoming invalid?
        }
    }

    updateAllDropdowns() {
        const dropdowns = this.container.querySelectorAll('select');
        dropdowns.forEach(select => this.populateDropdown(select));
    }

    async handleSelectionChange(event, cardId) {
        const selectElement = event.target;
        const newDeviceId = selectElement.value;
        const oldDeviceId = this.selectedDevices[cardId]?.deviceId;
        const device = this.availableDevices.find(d => d.id === newDeviceId);
        const deviceName = device ? device.name : 'Unknown';
        const testButton = document.getElementById(`test-${cardId}`);
        const statusSpan = document.getElementById(`status-${cardId}`);
        statusSpan.textContent = ''; // Clear status

        // If a device was previously selected, deactivate it first
        if (oldDeviceId && oldDeviceId !== newDeviceId) {
            await this.deactivateDevice(oldDeviceId, cardId); // Send request to backend
        }

        if (newDeviceId) {
            this.selectedDevices[cardId] = { deviceId: newDeviceId, name: deviceName };
            testButton.disabled = false;
            // Activate the new device on the backend
            await this.activateDevice(newDeviceId, deviceName, cardId);
        } else {
            // Placeholder selected
            this.selectedDevices[cardId] = { deviceId: '', name: '' };
            testButton.disabled = true;
            // No need to explicitly deactivate if oldDeviceId was already handled
        }

        // Update other dropdowns to reflect availability changes
        this.updateAllDropdowns();
    }

    async activateDevice(deviceId, deviceName, cardId) {
        logToConsole(`Activating audio device: ${deviceName} (${deviceId})`, 'info');
        const statusSpan = document.getElementById(`status-${cardId}`);
        try {
            // TODO: Replace with actual API call POST /api/audio/activate
            const response = await fetch('/api/audio/activate', { // Placeholder URL
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ deviceId, name: deviceName }),
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error ${response.status}`);
            }
            logToConsole(`Device ${deviceId} activated successfully.`, 'success');
             if(statusSpan) statusSpan.textContent = 'Active';
        } catch (error) {
            logToConsole(`Error activating audio device ${deviceId}: ${error.message}`, 'error');
             if(statusSpan) statusSpan.textContent = 'Activation Error';
             // Optional: Revert selection in UI?
        }
    }

    async deactivateDevice(deviceId, cardId) {
        logToConsole(`Deactivating audio device: ${deviceId}`, 'warn');
         const statusSpan = document.getElementById(`status-${cardId}`);
        try {
            // TODO: Replace with actual API call DELETE /api/audio/deactivate/:deviceId
            const response = await fetch(`/api/audio/deactivate/${encodeURIComponent(deviceId)}`, { // Placeholder URL
                method: 'DELETE',
            });
             const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `HTTP error ${response.status}`);
            }
            logToConsole(`Device ${deviceId} deactivated successfully.`, 'success');
             if(statusSpan && !document.getElementById(`select-${cardId}`).value) statusSpan.textContent = ''; // Clear only if no new device selected
        } catch (error) {
            logToConsole(`Error deactivating audio device ${deviceId}: ${error.message}`, 'error');
            // Don't show error in status span usually, as it might be replaced by 'Active' immediately
        }
    }

    async handleTestClick(cardId) {
        const deviceSelection = this.selectedDevices[cardId];
        if (!deviceSelection || !deviceSelection.deviceId) {
            logToConsole('No device selected for testing in card:', cardId, 'warn');
            return;
        }

        const deviceId = deviceSelection.deviceId;
        const testButton = document.getElementById(`test-${cardId}`);
        const statusSpan = document.getElementById(`status-${cardId}`);

        logToConsole(`Initiating test for audio device ${deviceId} from card ${cardId}...`, 'info');
        testButton.disabled = true;
        statusSpan.textContent = 'Testing...';

        try {
            const response = await fetch('/api/audio/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId: deviceId }),
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || `HTTP error! status: ${response.status}`);
            }
            statusSpan.textContent = `Test OK`;
            logToConsole(`Test successful for ${deviceId}: ${result.message}`, 'success');
            // Optionally show result.filePath briefly
            setTimeout(() => {
                 if (statusSpan.textContent === 'Test OK') {
                     statusSpan.textContent = 'Active'; // Revert to active status
                 }
            }, 3000);

        } catch (error) {
            logToConsole(`Error testing audio device ${deviceId}: ${error.message}`, 'error');
            statusSpan.textContent = `Test Failed`;
        } finally {
            // Re-enable button only if a device is still selected
            const selectElement = document.getElementById(`select-${cardId}`);
            if (selectElement && selectElement.value) {
                 testButton.disabled = false;
            }
            // Clear Fail/OK status after a bit, revert to 'Active' if appropriate
            setTimeout(() => {
                 if (statusSpan.textContent === 'Test Failed') {
                    const selectElement = document.getElementById(`select-${cardId}`);
                    statusSpan.textContent = selectElement && selectElement.value ? 'Active' : 'Activation Error'; // Or just empty?
                 }
            }, 5000);
        }
    }

    async handleRemoveClick(cardId) {
        const cardElement = document.getElementById(cardId);
        const selectedInfo = this.selectedDevices[cardId];

        if (selectedInfo && selectedInfo.deviceId) {
            // Deactivate device on backend first
            await this.deactivateDevice(selectedInfo.deviceId, cardId);
        }

        // Remove from state and DOM
        delete this.selectedDevices[cardId];
        if (cardElement) {
            cardElement.remove();
        }

        logToConsole(`Removed audio device card: ${cardId}`, 'info');
        // Update dropdowns in remaining cards
        this.updateAllDropdowns();
    }
} 