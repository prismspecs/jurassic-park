import { logToConsole } from './logger.js';

export class AudioManager {
    constructor() {
        this.container = document.getElementById('audioDeviceControls');
        this.availableDevices = []; // Fetched from /api/audio/devices
        this.selectedDevices = {}; // Store selected devices: { cardId: { deviceId: '', name: '' } }
        this.deviceCardStates = {}; // Store UI state per card: { cardId: { gainDb: number, channels: number[] } }
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
            // Log available devices to help user configure defaults
            logToConsole('Available audio devices for matching defaults:', 'debug', JSON.stringify(this.availableDevices.map(d => ({ id: d.id, name: d.name }))));

            logToConsole('Loaded audioDefaults from config:', 'debug', JSON.stringify(audioDefaults)); // Log the actual defaults being used

            audioDefaults.forEach((defaultConfig, index) => {
                if (defaultConfig && defaultConfig.device) {
                    const defaultNameLower = defaultConfig.device.toLowerCase();
                    logToConsole(`Attempting to match default config device: '${defaultConfig.device}' (lowercase: '${defaultNameLower}')`, 'debug');

                    // Find the best partial match (case-insensitive)
                    const matchedDevice = this.availableDevices.find(availDevice => {
                        const availDeviceNameLower = availDevice.name ? availDevice.name.toLowerCase() : '';
                        const isMatch = availDevice.name && availDeviceNameLower.includes(defaultNameLower);
                        logToConsole(`  Comparing with available: '${availDevice.name}' (lowercase: '${availDeviceNameLower}'). Includes '${defaultNameLower}'? ${isMatch}`, 'debug');
                        return isMatch;
                    });

                    if (matchedDevice) {
                        logToConsole(`Found match for default audio device ('${defaultConfig.device}'): ${matchedDevice.name} (${matchedDevice.id})`, 'info');
                        // Check if a card for this DEVICE ID already exists
                        let cardAlreadyExists = false;
                        for (const cardId in this.selectedDevices) {
                            // Check if the deviceId associated with any existing card matches the one we just found
                            if (this.selectedDevices[cardId].deviceId === matchedDevice.id) {
                                cardAlreadyExists = true;
                                logToConsole(`Device ${matchedDevice.name} (${matchedDevice.id}) is already added to a card (${cardId}). Skipping auto-add.`, 'info');
                                break; // Exit the loop once found
                            }
                        }

                        if (!cardAlreadyExists) {
                            logToConsole(`Adding default audio device card for: ${matchedDevice.name}`, 'info');
                            this.addDeviceCard(matchedDevice.id, matchedDevice.name);
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

        // --- Initialize state for this card (Moved Earlier) ---
        this.selectedDevices[cardId] = { deviceId: '', name: '' };
        const defaultGain = 0; // Default gain 0 dB
        const defaultChannels = [1]; // Default to mono channel 1
        this.deviceCardStates[cardId] = { gainDb: defaultGain, channels: defaultChannels };
        // --- End Initialization ---

        // --- Gain Control --- 
        const gainDiv = document.createElement('div');
        gainDiv.classList.add('control-group', 'audio-gain-control');

        const gainLabel = document.createElement('label');
        gainLabel.setAttribute('for', `gain-${cardId}`);
        gainLabel.textContent = 'Gain (dB):';

        const gainSlider = document.createElement('input');
        gainSlider.type = 'range';
        gainSlider.id = `gain-${cardId}`;
        gainSlider.min = '-24'; // Example range -24dB to +12dB
        gainSlider.max = '12';
        gainSlider.step = '1';
        gainSlider.value = String(this.deviceCardStates[cardId].gainDb); // Set initial value from state
        gainSlider.style.width = 'calc(100% - 100px)'; // Adjust width
        gainSlider.style.verticalAlign = 'middle';

        const gainValueSpan = document.createElement('span');
        gainValueSpan.id = `gain-value-${cardId}`;
        gainValueSpan.textContent = ` ${this.deviceCardStates[cardId].gainDb} dB`; // Set initial value from state
        gainValueSpan.style.marginLeft = '10px';

        gainSlider.addEventListener('input', (event) => {
            const newGainDb = parseInt(event.target.value, 10);
            gainValueSpan.textContent = ` ${newGainDb} dB`;
            this.deviceCardStates[cardId].gainDb = newGainDb;
            this.sendConfigUpdate(cardId);
        });

        gainDiv.appendChild(gainLabel);
        gainDiv.appendChild(gainSlider);
        gainDiv.appendChild(gainValueSpan);
        cardDiv.appendChild(gainDiv);

        // --- Channel Selection --- 
        // TODO: Base channel selection dynamically on detected channelCount when implemented
        const channelDiv = document.createElement('div');
        channelDiv.classList.add('control-group', 'audio-channel-control');

        const channelLabel = document.createElement('label');
        channelLabel.textContent = 'Channels:';
        channelDiv.appendChild(channelLabel);

        const options = [
            { label: 'Mono (Ch 1)', value: [1] },
            { label: 'Mono (Ch 2)', value: [2] },
            { label: 'Stereo (Ch 1+2)', value: [1, 2] }
            // Add more options if channelCount > 2 is detected later
        ];

        options.forEach(option => {
            const wrapper = document.createElement('span');
            wrapper.style.marginRight = '15px';

            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = `channels-${cardId}`;
            radio.id = `channels-${cardId}-${option.label.replace(/[^a-zA-Z0-9]/g, '-')}`;
            radio.value = JSON.stringify(option.value);
            // Check if this option matches the default/current state
            if (JSON.stringify(option.value) === JSON.stringify(this.deviceCardStates[cardId].channels)) {
                radio.checked = true;
            }

            radio.addEventListener('change', (event) => {
                if (event.target.checked) {
                    const newChannels = JSON.parse(event.target.value);
                    this.deviceCardStates[cardId].channels = newChannels;
                    this.sendConfigUpdate(cardId);
                }
            });

            const label = document.createElement('label');
            label.setAttribute('for', radio.id);
            label.textContent = option.label;
            label.style.marginLeft = '5px';

            wrapper.appendChild(radio);
            wrapper.appendChild(label);
            channelDiv.appendChild(wrapper);
        });

        cardDiv.appendChild(channelDiv);

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
        // Reset gain/channel UI elements when device changes (optional, but good practice)
        const gainSlider = document.getElementById(`gain-${cardId}`);
        const gainValueSpan = document.getElementById(`gain-value-${cardId}`);
        const channelRadios = document.querySelectorAll(`input[name="channels-${cardId}"]`);
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
            await this.sendConfigUpdate(cardId); // Send current gain/channel settings for the newly selected device
        } else {
            // Placeholder selected
            this.selectedDevices[cardId] = { deviceId: '', name: '' };
            testButton.disabled = true;
            // Reset/clear UI state if needed when no device is selected
            if (gainSlider) gainSlider.value = '0';
            if (gainValueSpan) gainValueSpan.textContent = ' 0 dB';
            // Reset radios to default (e.g., Mono Ch 1)
            const defaultChannelRadio = document.getElementById(`channels-${cardId}-Mono--Ch-1-`);
            if (defaultChannelRadio) defaultChannelRadio.checked = true;
            this.deviceCardStates[cardId] = { gainDb: 0, channels: [1] }; // Reset internal state too
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
            if (statusSpan) statusSpan.textContent = ''; // Removed 'Active' text
        } catch (error) {
            logToConsole(`Error activating audio device ${deviceId}: ${error.message}`, 'error');
            if (statusSpan) statusSpan.textContent = ''; // Removed 'Active' text, change from 'Active' to empty string
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
            if (statusSpan && !document.getElementById(`select-${cardId}`).value) statusSpan.textContent = ''; // Clear only if no new device selected
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

        // Remove the card's state
        delete this.deviceCardStates[cardId];

        logToConsole(`Removed audio device card: ${cardId}`, 'info');
        // Update dropdowns in remaining cards
        this.updateAllDropdowns();
    }

    // --- NEW: Send config update to backend ---
    async sendConfigUpdate(cardId) {
        const state = this.deviceCardStates[cardId];
        const device = this.selectedDevices[cardId];
        if (!device || !device.deviceId) {
            logToConsole(`Cannot send config update for ${cardId}: No device selected.`, 'warn');
            return;
        }
        const deviceId = device.deviceId; // Get the actual device ID

        const payload = {
            gainDb: state.gainDb,
            channels: state.channels
        };

        logToConsole(`Sending config update for ${deviceId}: ${JSON.stringify(payload)}`, 'info');

        try {
            const response = await fetch(`/api/audio/config/${encodeURIComponent(deviceId)}`, { // Ensure deviceId is encoded
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!response.ok) {
                const errorResult = await response.json();
                throw new Error(`Failed to update config: ${response.status} - ${errorResult.error || 'Unknown error'}`);
            }
            const result = await response.json();
            logToConsole(`Config update successful for ${deviceId}: ${result.message}`, 'info');
        } catch (error) {
            logToConsole(`Error sending config update for ${deviceId}: ${error.message}`, 'error');
            // Optionally revert UI state or show error to user
        }
    }
    // --- END NEW ---
} 