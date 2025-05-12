import { logToConsole } from './logger.js';

export class AudioManager {
    constructor() {
        this.container = document.getElementById('audioDeviceControls');
        this.availableDevices = []; // Will store { id: string, name: string, channelCount: number }
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
                            logToConsole(`Adding default audio device card for: ${matchedDevice.name} with config: ${JSON.stringify(defaultConfig)}`, 'info');
                            // Pass the full defaultConfig object to addDeviceCard
                            this.addDeviceCard(matchedDevice.id, matchedDevice.name, defaultConfig);
                        }
                        // Note: If card already exists, we currently DON'T apply defaults. 
                        // Could be enhanced later if needed.
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
            const devices = await response.json();
            // Ensure channelCount is stored, provide default if missing
            this.availableDevices = devices.map(device => ({
                ...device,
                channelCount: device.channelCount || 2 // Default to 2 if backend didn't provide it
            }));
            logToConsole(`Available audio devices fetched: ${this.availableDevices.length}`, 'info', JSON.stringify(this.availableDevices)); // Log fetched data including channel counts
        } catch (error) {
            logToConsole(`Error fetching available audio devices: ${error.message}`, 'error');
            this.availableDevices = []; // Reset on error
        }
        // Update dropdowns in case devices changed (e.g., on re-fetch)
        this.updateAllDropdowns();
    }

    addDeviceCard(defaultDeviceId = null, defaultDeviceName = null, defaultConfig = {}) {
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

        // --- Channel Selection --- 
        const channelContainer = document.createElement('div'); // Renamed from channelDiv for clarity
        channelContainer.classList.add('control-group', 'audio-channel-control');
        channelContainer.id = `channel-container-${cardId}`; // Add ID for easy targeting

        const channelLabel = document.createElement('label');
        channelLabel.textContent = 'Channels:';
        channelContainer.appendChild(channelLabel);

        // Placeholder for dynamic content
        const channelOptionsDiv = document.createElement('div');
        channelOptionsDiv.id = `channel-options-${cardId}`;
        channelOptionsDiv.style.display = 'inline-block';
        channelOptionsDiv.style.marginLeft = '10px';
        channelContainer.appendChild(channelOptionsDiv);
        cardDiv.appendChild(channelContainer);

        // --- Initialize state for this card, using defaultConfig if provided --- 
        this.selectedDevices[cardId] = { deviceId: '', name: '' };
        // Use defaults from config, fallback to 0dB and [1] if not specified
        const initialGain = typeof defaultConfig.gainDb === 'number' ? defaultConfig.gainDb : 0;
        const initialChannels = Array.isArray(defaultConfig.channels) && defaultConfig.channels.length > 0 ? defaultConfig.channels : [1];
        this.deviceCardStates[cardId] = { gainDb: initialGain, channels: initialChannels };

        // Initial rendering of channel options
        const initialDevice = this.availableDevices.find(d => d.id === defaultDeviceId);
        const initialChannelCount = initialDevice?.channelCount || 2;
        // Pass the newly created channelOptionsDiv directly
        this._renderChannelOptions(cardId, initialChannelCount, channelOptionsDiv);

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
        // Set initial slider value from state (which includes defaults)
        gainSlider.value = String(this.deviceCardStates[cardId].gainDb);
        gainSlider.style.width = 'calc(100% - 100px)'; // Adjust width
        gainSlider.style.verticalAlign = 'middle';

        const gainValueSpan = document.createElement('span');
        gainValueSpan.id = `gain-value-${cardId}`;
        // Set initial span text from state
        gainValueSpan.textContent = ` ${this.deviceCardStates[cardId].gainDb} dB`;
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

        // If a default device was provided, select it and trigger update
        if (defaultDeviceId) {
            logToConsole(`Pre-selecting default device ${defaultDeviceName} (${defaultDeviceId}) for card ${cardId}`, 'info');
            select.value = defaultDeviceId;
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
        const channelCount = device ? device.channelCount : 2; // Get channel count or default to 2
        const testButton = document.getElementById(`test-${cardId}`);
        const statusSpan = document.getElementById(`status-${cardId}`);
        // Reset gain/channel UI elements when device changes (optional, but good practice)
        const gainSlider = document.getElementById(`gain-${cardId}`);
        const gainValueSpan = document.getElementById(`gain-value-${cardId}`);
        // We don't need channelRadios anymore
        statusSpan.textContent = ''; // Clear status

        // Deactivate old device if necessary
        if (oldDeviceId && oldDeviceId !== newDeviceId) {
            await this.deactivateDevice(oldDeviceId, cardId);
        }

        if (newDeviceId && device) {
            this.selectedDevices[cardId] = { deviceId: newDeviceId, name: deviceName };
            testButton.disabled = false;

            // Reset card state (gain to 0, channels to [1])
            const defaultChannels = [1];
            this.deviceCardStates[cardId] = { gainDb: 0, channels: defaultChannels };
            if (gainSlider) gainSlider.value = '0';
            if (gainValueSpan) gainValueSpan.textContent = ' 0 dB';

            // Re-render channel options for the new device
            // Find the options container element for this specific card
            const optionsContainer = document.getElementById(`channel-options-${cardId}`);
            if (optionsContainer) {
                this._renderChannelOptions(cardId, channelCount, optionsContainer);
            } else {
                console.error(`Cannot find options container for card ${cardId} during selection change.`);
            }

            // Activate the new device and send initial config
            await this.activateDevice(newDeviceId, deviceName, cardId);
            await this.sendConfigUpdate(cardId); // Send the reset config (gain 0, ch [1])
        } else {
            // Placeholder selected or device not found
            this.selectedDevices[cardId] = { deviceId: '', name: '' };
            testButton.disabled = true;
            const defaultChannels = [1];
            this.deviceCardStates[cardId] = { gainDb: 0, channels: defaultChannels }; // Reset internal state
            if (gainSlider) gainSlider.value = '0';
            if (gainValueSpan) gainValueSpan.textContent = ' 0 dB';

            // Render default channel options
            const optionsContainer = document.getElementById(`channel-options-${cardId}`);
            if (optionsContainer) {
                this._renderChannelOptions(cardId, 2, optionsContainer); // Default to 2 channels
            } else {
                console.error(`Cannot find options container for card ${cardId} when clearing selection.`);
            }
        }

        this.updateAllDropdowns();
    }

    async activateDevice(deviceId, deviceName, cardId) {
        logToConsole(`Activating audio device: ${deviceName} (${deviceId})`, 'info');
        const statusSpan = document.getElementById(`status-${cardId}`);

        // Find the device details, including channelCount, from the available devices list
        const device = this.availableDevices.find(d => d.id === deviceId);
        const channelCount = device?.channelCount; // May be undefined if device not found

        try {
            // Send deviceId, name, AND channelCount to the backend
            const response = await fetch('/api/audio/active-devices', { // Updated URL to match route
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    deviceId,
                    name: deviceName,
                    channelCount // Include channel count in the payload
                }),
            });
            const result = await response.json(); // Assume response is always JSON, check ok status
            if (!response.ok) {
                // Use error message from backend if available
                throw new Error(result.error || `HTTP error ${response.status}`);
            }
            logToConsole(`Device ${deviceId} activated successfully (Channels: ${channelCount ?? 'N/A'}).`, 'success');
            if (statusSpan) statusSpan.textContent = ''; // Clear status
        } catch (error) {
            logToConsole(`Error activating audio device ${deviceId}: ${error.message}`, 'error');
            if (statusSpan) statusSpan.textContent = ''; // Clear status on error too
            // Optional: Revert selection in UI?
        }
    }

    async deactivateDevice(deviceId, cardId) {
        logToConsole(`Deactivating audio device: ${deviceId}`, 'warn');
        const statusSpan = document.getElementById(`status-${cardId}`);
        try {
            // Use the correct route: DELETE /api/audio/active-devices/:deviceId
            const response = await fetch(`/api/audio/active-devices/${encodeURIComponent(deviceId)}`, {
                method: 'DELETE',
            });
            const result = await response.json(); // Assume response is always JSON
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

    // Update the function signature and remove getElementById
    _renderChannelOptions(cardId, channelCount, optionsContainer) {
        logToConsole(`Rendering channel options for card ${cardId} with count ${channelCount}`, 'debug');
        if (!optionsContainer) {
            // This check might still be useful if called from elsewhere unexpectedly
            console.error(`_renderChannelOptions called with null optionsContainer for card ${cardId}`);
            return;
        }
        optionsContainer.innerHTML = ''; // Clear previous options

        // --- Create Checkboxes for channels 1 to channelCount ---
        for (let i = 1; i <= channelCount; i++) {
            const wrapper = document.createElement('span');
            wrapper.style.marginRight = '15px';
            wrapper.style.display = 'inline-block'; // Ensure wrap nicely
            wrapper.style.whiteSpace = 'nowrap';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = `channels-${cardId}`;
            checkbox.id = `channel-${cardId}-${i}`;
            checkbox.value = i; // Store the channel number

            // Check if this channel is currently selected in the state
            const currentState = this.deviceCardStates[cardId];
            if (currentState && currentState.channels && currentState.channels.includes(i)) {
                checkbox.checked = true;
            }

            checkbox.addEventListener('change', (event) => {
                const currentChannels = this.deviceCardStates[cardId]?.channels || [];
                const channelNum = parseInt(event.target.value, 10);
                let newChannels;

                if (event.target.checked) {
                    // Add channel if not already present
                    if (!currentChannels.includes(channelNum)) {
                        newChannels = [...currentChannels, channelNum].sort((a, b) => a - b); // Keep sorted
                    } else {
                        newChannels = currentChannels; // Should not happen if logic is correct
                    }
                } else {
                    // Remove channel
                    newChannels = currentChannels.filter(ch => ch !== channelNum);
                    // If removing the last channel, default back to channel 1
                    if (newChannels.length === 0) {
                        newChannels = [1];
                        // Update the UI to reflect this default selection
                        const firstChannelCheckbox = document.getElementById(`channel-${cardId}-1`);
                        if (firstChannelCheckbox) firstChannelCheckbox.checked = true;
                    }
                }

                this.deviceCardStates[cardId].channels = newChannels;
                logToConsole(`Card ${cardId} channels updated: ${JSON.stringify(newChannels)}`, 'debug');
                this.sendConfigUpdate(cardId);
            });

            const label = document.createElement('label');
            label.setAttribute('for', checkbox.id);
            label.textContent = `Ch ${i}`;
            label.style.marginLeft = '5px';

            wrapper.appendChild(checkbox);
            wrapper.appendChild(label);
            optionsContainer.appendChild(wrapper);
        }

        // Ensure initial state is reflected after rendering (especially if default [1] wasn't checked)
        const firstChannelCheckbox = document.getElementById(`channel-${cardId}-1`);
        const currentState = this.deviceCardStates[cardId];
        if (currentState.channels.length === 1 && currentState.channels[0] === 1 && firstChannelCheckbox && !firstChannelCheckbox.checked) {
            firstChannelCheckbox.checked = true;
        }
    }
} 