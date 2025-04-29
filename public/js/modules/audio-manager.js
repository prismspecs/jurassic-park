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
        
        // Fetch available devices first
        await this.fetchAvailableDevices();
        
        // Then fetch defaults
        let audioDefaults = [];
        try {
            const defaultsResponse = await fetch('/api/audio/defaults');
            if (defaultsResponse.ok) {
                audioDefaults = await defaultsResponse.json();
                logToConsole(`Fetched ${audioDefaults.length} audio defaults.`, 'info');
            } else {
                logToConsole(`Failed to fetch audio defaults: ${defaultsResponse.status}`, 'warn');
            }
        } catch (error) {
            logToConsole(`Error fetching audio defaults: ${error.message}`, 'error');
        }

        // Attempt to add default devices
        if (this.availableDevices.length > 0 && audioDefaults.length > 0) {
            audioDefaults.forEach((defaultConfig, index) => {
                if (defaultConfig && defaultConfig.device) {
                    const defaultNameLower = defaultConfig.device.toLowerCase();
                    // Find the best partial match (case-insensitive)
                    const matchedDevice = this.availableDevices.find(availDevice => 
                        availDevice.name && availDevice.name.toLowerCase().includes(defaultNameLower)
                    );

                    if (matchedDevice) {
                        logToConsole(`Found match for default audio device ${index} ('${defaultConfig.device}'): ${matchedDevice.name} (${matchedDevice.id})`, 'info');
                        // Check if a card for this index already exists (e.g., manually added)
                        // This check assumes we might add more robust card management later.
                        // For now, we just add based on the default index.
                        const existingCardForIndex = document.getElementById(`audio-card-${index + 1}`);
                        if (!existingCardForIndex) {
                           logToConsole(`Adding default audio device card for index ${index}...`, 'info');
                           this.addDeviceCard(matchedDevice.id, matchedDevice.name);
                        } else {
                           logToConsole(`Card for default audio index ${index} already exists. Skipping auto-add.`, 'info');
                        }
                    } else {
                        logToConsole(`Could not find a matching available device for default audio: '${defaultConfig.device}'`, 'warn');
                    }
                }
            });
        }

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

    addDeviceCard(defaultDeviceId = null, defaultDeviceName = null) {
        if (!this.container) return;

        this.deviceCardCounter++;
        const cardId = `audio-card-${this.deviceCardCounter}`;
        const cardDiv = document.createElement('div');
        // Use similar class structure to camera card for potential style reuse
        cardDiv.classList.add('audio-device-card', 'camera-control'); 
        cardDiv.id = cardId;

        // --- Title and Remove Button (similar to camera card) ---
        const titleContainer = document.createElement('div');
        titleContainer.style.display = 'flex';
        titleContainer.style.justifyContent = 'space-between';
        titleContainer.style.alignItems = 'center';

        const title = document.createElement('h3');
        title.textContent = `Recording Device ${this.deviceCardCounter}`;
        
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '❌'; // Changed from '✖' to '❌' to match camera panel
        removeBtn.classList.add('remove-btn'); // Add specific class for styling/selection
        removeBtn.title = 'Remove this audio device';
        removeBtn.addEventListener('click', () => this.handleRemoveClick(cardId));

        titleContainer.appendChild(title);
        titleContainer.appendChild(removeBtn);
        cardDiv.appendChild(titleContainer);

        // --- Dropdown Selection --- 
        const selectionDiv = document.createElement('div');
        selectionDiv.classList.add('control-group'); // Class for styling label/select pairs

        const selectLabel = document.createElement('label');
        selectLabel.setAttribute('for', `select-${cardId}`);
        selectLabel.textContent = 'Audio Device:';

        const select = document.createElement('select');
        select.id = `select-${cardId}`;
        select.innerHTML = '<option value="">-- Select Audio Device --</option>';
        this.populateDropdown(select); // Populate before adding listener
        select.addEventListener('change', (event) => this.handleSelectionChange(event, cardId));

        selectionDiv.appendChild(selectLabel);
        selectionDiv.appendChild(select);
        cardDiv.appendChild(selectionDiv);

        // --- Test Button and Status --- 
        const controlsDiv = document.createElement('div');
        controlsDiv.classList.add('audio-controls'); // Class for styling test/status

        const testBtn = document.createElement('button');
        testBtn.id = `test-${cardId}`;
        testBtn.textContent = 'Test Record Audio'; // Changed from 'Test' to 'Test Record Audio'
        testBtn.disabled = true;
        testBtn.addEventListener('click', () => this.handleTestClick(cardId));

        const statusSpan = document.createElement('span');
        statusSpan.id = `status-${cardId}`;
        statusSpan.classList.add('status-indicator');
        statusSpan.style.marginLeft = '10px'; // Add some space

        controlsDiv.appendChild(testBtn);
        controlsDiv.appendChild(statusSpan);
        cardDiv.appendChild(controlsDiv);

        // Append the fully constructed card to the main container
        this.container.appendChild(cardDiv);

        // Initialize state for this card
        this.selectedDevices[cardId] = { deviceId: '', name: '' };

        // If a default device was provided, select it
        if (defaultDeviceId) {
            logToConsole(`Pre-selecting default device ${defaultDeviceName} (${defaultDeviceId}) for card ${cardId}`, 'info');
            select.value = defaultDeviceId; // Set dropdown value
            // Trigger the change handler logic to activate the device and update state
            this.handleSelectionChange({ target: select }, cardId);
        }
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

        // Restore selection if it's still valid OR if it was passed as a default
        const defaultValue = selectElement.value; // Check if a value was pre-set (by default)
        if (defaultValue && options.some(d => d.id === defaultValue)) {
            // Keep the pre-set default value
            selectElement.value = defaultValue;
        } else if (options.some(d => d.id === currentlySelectedInThisDropdown)) {
            // Restore previous selection if still valid and no default was set
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
             if(statusSpan) statusSpan.textContent = ''; // Removed 'Active' text
        } catch (error) {
            logToConsole(`Error activating audio device ${deviceId}: ${error.message}`, 'error');
             if(statusSpan) statusSpan.textContent = ''; // Removed 'Active' text, change from 'Active' to empty string
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
                     statusSpan.textContent = ''; // Removed 'Active' text, change from 'Active' to empty string
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
                    statusSpan.textContent = selectElement && selectElement.value ? '' : ''; // Changed from 'Active'/'Activation Error' to empty
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